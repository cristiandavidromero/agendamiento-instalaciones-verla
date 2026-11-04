// Reserva exclusiva: toma las candidatas del motor y se queda con la primera que logre
// insertar dentro de una transacción con la cuadrilla bloqueada (SELECT ... FOR UPDATE).
// La restricción cita_sin_solapamiento en la BD es la red de seguridad final.

import { Prisma, type Cita, type PrismaClient } from "@prisma/client";
import { prisma as prismaPorDefecto } from "@/lib/prisma";
import { calcularCandidatas, HORIZONTE_DIAS, type Candidata } from "@/dominio/disponibilidad";
import { fechaLocal, instanteLocal, sumarDias, ZONA_NEGOCIO } from "@/dominio/tiempo";

// intentos: franjas probadas. choques: inserciones rechazadas por cita_sin_solapamiento
// (con el bloqueo activo debería ser 0: la revalidación descarta la franja antes de insertar).
export type ResultadoAgenda =
  | { estado: "AGENDADA"; cita: Cita; intentos: number; choques: number }
  | { estado: "SIN_CUPO"; intentos: number; choques: number };

export interface OpcionesAgenda {
  ahora?: Date;
  db?: PrismaClient;
  // Solo para la prueba de control: sin FOR UPDATE, la restricción de la BD es la única defensa.
  bloquearCuadrilla?: boolean;
}

export class VentaNoEncontradaError extends Error {
  constructor(ventaId: number) {
    super(`La venta ${ventaId} no existe`);
    this.name = "VentaNoEncontradaError";
  }
}

// ¿El error es la restricción de exclusión (dos citas de la misma cuadrilla cruzadas)?
export function esChoqueDeCita(error: unknown): boolean {
  const texto = error instanceof Error ? error.message : String(error);
  return texto.includes("cita_sin_solapamiento") || texto.includes("23P01");
}

// Conflicto transitorio: PostgreSQL abortó la transacción para romper un ciclo de esperas.
// Puede darse entre inserciones concurrentes que se vigilan en la restricción de exclusión.
export function esBloqueoMutuo(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return true;
  const texto = error instanceof Error ? error.message : String(error);
  return texto.includes("40P01") || texto.includes("deadlock detected");
}

const esVentaYaAgendada = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002" &&
  JSON.stringify(error.meta?.target ?? "").includes("venta_id");

// Lee de la BD lo que el motor necesita y devuelve las candidatas ordenadas.
export async function buscarCandidatas(ventaId: number, { ahora = new Date(), db = prismaPorDefecto }: OpcionesAgenda = {}) {
  const venta = await db.venta.findUnique({
    where: { id: ventaId },
    include: { tipoServicio: true, cita: true },
  });
  if (!venta) throw new VentaNoEncontradaError(ventaId);
  if (venta.cita) return { venta, candidatas: [] };

  const cuadrillas = await db.cuadrilla.findMany({
    where: { contratista: { ciudades: { some: { ciudadId: venta.ciudadId } } } },
    include: { disponibilidades: true },
  });

  const hoy = fechaLocal(ahora, ZONA_NEGOCIO);
  const citas = await db.cita.findMany({
    where: {
      cuadrillaId: { in: cuadrillas.map((c) => c.id) },
      fin: { gt: instanteLocal(hoy, 0) },
      inicio: { lt: instanteLocal(sumarDias(hoy, HORIZONTE_DIAS), 0) },
    },
    select: { cuadrillaId: true, inicio: true, fin: true },
  });

  const candidatas = calcularCandidatas({
    ahora,
    duracionMin: venta.tipoServicio.duracionMin,
    cuadrillas: cuadrillas.map((c) => ({
      id: c.id,
      capacidadDiaria: c.capacidadDiaria,
      bloques: c.disponibilidades,
    })),
    citas,
  });

  return { venta, candidatas };
}

// Intenta reservar una franja. Devuelve null si al revalidar con la cuadrilla bloqueada
// la franja ya no está libre o la cuadrilla llenó su capacidad del día.
async function reservarFranja(
  db: PrismaClient,
  ventaId: number,
  franja: Candidata,
  bloquearCuadrilla: boolean,
): Promise<Cita | null> {
  const dia = fechaLocal(franja.inicio, ZONA_NEGOCIO);
  const inicioDia = instanteLocal(dia, 0);
  const finDia = instanteLocal(sumarDias(dia, 1), 0);

  return db.$transaction(
    async (tx) => {
      const [cuadrilla] = bloquearCuadrilla
        ? await tx.$queryRaw<{ capacidad_diaria: number }[]>`
            SELECT capacidad_diaria FROM cuadrilla WHERE id = ${franja.cuadrillaId} FOR UPDATE`
        : await tx.$queryRaw<{ capacidad_diaria: number }[]>`
            SELECT capacidad_diaria FROM cuadrilla WHERE id = ${franja.cuadrillaId}`;
      if (!cuadrilla) return null;

      // En READ COMMITTED esta consulta ve todo lo confirmado por quien tuvo el bloqueo antes.
      const [{ cruces, del_dia }] = await tx.$queryRaw<{ cruces: number; del_dia: number }[]>`
        SELECT
          count(*) FILTER (WHERE inicio < ${franja.fin} AND fin > ${franja.inicio})::int AS cruces,
          count(*) FILTER (WHERE inicio >= ${inicioDia} AND inicio < ${finDia})::int     AS del_dia
        FROM cita WHERE cuadrilla_id = ${franja.cuadrillaId}`;
      if (cruces > 0 || del_dia >= cuadrilla.capacidad_diaria) return null;

      const cita = await tx.cita.create({
        data: { ventaId, cuadrillaId: franja.cuadrillaId, inicio: franja.inicio, fin: franja.fin },
      });
      await tx.venta.update({ where: { id: ventaId }, data: { estado: "AGENDADA" } });
      return cita;
    },
    { maxWait: 10_000, timeout: 10_000 },
  );
}

// Recorre las candidatas en orden y se queda con la primera que logre reservar.
export async function reservarPrimeraDisponible(
  ventaId: number,
  candidatas: Candidata[],
  { db = prismaPorDefecto, bloquearCuadrilla = true }: Pick<OpcionesAgenda, "db" | "bloquearCuadrilla"> = {},
): Promise<ResultadoAgenda> {
  let intentos = 0;
  let choques = 0;
  for (const franja of candidatas) {
    intentos++;
    try {
      const cita = await reservarFranja(db, ventaId, franja, bloquearCuadrilla);
      if (cita) return { estado: "AGENDADA", cita, intentos, choques };
    } catch (error) {
      // Otra transacción ganó la franja: probar la siguiente. En un bloqueo mutuo PostgreSQL
      // aborta solo a una de las partes; la otra sigue y se queda con la franja.
      if (esChoqueDeCita(error) || esBloqueoMutuo(error)) {
        choques++;
        continue;
      }
      if (esVentaYaAgendada(error)) {
        // Otra llamada concurrente agendó esta misma venta.
        const cita = await db.cita.findUniqueOrThrow({ where: { ventaId } });
        return { estado: "AGENDADA", cita, intentos, choques };
      }
      throw error;
    }
  }

  await db.venta.updateMany({ where: { id: ventaId, estado: "ABIERTA" }, data: { estado: "CERRADA" } });
  return { estado: "SIN_CUPO", intentos, choques };
}

// Punto de entrada al cerrar una venta. Idempotente: si ya tiene cita, la devuelve.
export async function agendarVenta(ventaId: number, opciones: OpcionesAgenda = {}): Promise<ResultadoAgenda> {
  const { venta, candidatas } = await buscarCandidatas(ventaId, opciones);
  if (venta.cita) return { estado: "AGENDADA", cita: venta.cita, intentos: 0, choques: 0 };
  return reservarPrimeraDisponible(ventaId, candidatas, opciones);
}
