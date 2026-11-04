// Bandeja de administración: mover, reasignar y liberar citas con trazabilidad.
// Mover y reasignar pasan por las mismas reglas que la reserva automática: la cuadrilla
// destino se bloquea con FOR UPDATE, la franja se valida con el motor de disponibilidad
// y la restricción cita_sin_solapamiento sigue siendo la red de seguridad.

import type { Cita, Prisma, PrismaClient } from "@prisma/client";
import { prisma as prismaPorDefecto } from "@/lib/prisma";
import { calcularCandidatas, HORIZONTE_DIAS, type CitaExistente } from "@/dominio/disponibilidad";
import { fechaLocal, instanteLocal, sumarDias } from "@/dominio/tiempo";
import { esChoqueDeCita } from "./agendar";

export class CitaNoEncontradaError extends Error {
  constructor(citaId: number) {
    super(`La cita ${citaId} no existe`);
    this.name = "CitaNoEncontradaError";
  }
}

export class CuadrillaNoEncontradaError extends Error {
  constructor(cuadrillaId: number) {
    super(`La cuadrilla ${cuadrillaId} no existe`);
    this.name = "CuadrillaNoEncontradaError";
  }
}

export class CuadrillaFueraDeCiudadError extends Error {
  constructor(cuadrillaId: number) {
    super(`La cuadrilla ${cuadrillaId} no atiende la ciudad de la venta`);
    this.name = "CuadrillaFueraDeCiudadError";
  }
}

export class FranjaNoDisponibleError extends Error {
  constructor() {
    super(
      "La franja no está disponible: se cruza con otra cita, no cabe en el horario, " +
        "la cuadrilla llegó a su capacidad del día o está fuera del horizonte",
    );
    this.name = "FranjaNoDisponibleError";
  }
}

interface Responsable {
  actor: string;
  motivo?: string;
}

interface OpcionesAdmin {
  ahora?: Date;
  db?: PrismaClient;
}

const OPCIONES_TX = { maxWait: 10_000, timeout: 10_000 };

type Tx = Prisma.TransactionClient;

// Citas de la cuadrilla dentro del horizonte, sin contar la que se está reprogramando.
function citasDelHorizonte(tx: Tx | PrismaClient, cuadrillaIds: number[], excluirCitaId: number, ahora: Date) {
  const hoy = fechaLocal(ahora);
  return tx.cita.findMany({
    where: {
      cuadrillaId: { in: cuadrillaIds },
      id: { not: excluirCitaId },
      fin: { gt: instanteLocal(hoy, 0) },
      inicio: { lt: instanteLocal(sumarDias(hoy, HORIZONTE_DIAS), 0) },
    },
    select: { cuadrillaId: true, inicio: true, fin: true },
  }) as Promise<CitaExistente[]>;
}

async function bloquearCita(tx: Tx, citaId: number) {
  const [fila] = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM cita WHERE id = ${citaId} FOR UPDATE`;
  if (!fila) throw new CitaNoEncontradaError(citaId);
  return tx.cita.findUniqueOrThrow({
    where: { id: citaId },
    include: { venta: { include: { tipoServicio: true } } },
  });
}

// Mueve la cita a otra franja (misma cuadrilla) o la reasigna (otra cuadrilla de la ciudad).
export async function reprogramarCita(
  citaId: number,
  destino: { cuadrillaId: number; inicio: Date } & Responsable,
  { ahora = new Date(), db = prismaPorDefecto }: OpcionesAdmin = {},
): Promise<Cita> {
  try {
    return await db.$transaction(async (tx) => {
      const cita = await bloquearCita(tx, citaId);
      if (cita.cuadrillaId === destino.cuadrillaId && cita.inicio.getTime() === destino.inicio.getTime()) {
        return cita; // sin cambios: no se registra nada
      }

      const cuadrilla = await tx.cuadrilla.findUnique({
        where: { id: destino.cuadrillaId },
        include: { disponibilidades: true, contratista: { include: { ciudades: true } } },
      });
      if (!cuadrilla) throw new CuadrillaNoEncontradaError(destino.cuadrillaId);
      if (!cuadrilla.contratista.ciudades.some((c) => c.ciudadId === cita.venta.ciudadId)) {
        throw new CuadrillaFueraDeCiudadError(destino.cuadrillaId);
      }

      // Mismo bloqueo que la reserva automática: serializa con ventas y otros cambios.
      await tx.$queryRaw`SELECT id FROM cuadrilla WHERE id = ${destino.cuadrillaId} FOR UPDATE`;

      const franja = calcularCandidatas({
        ahora,
        duracionMin: cita.venta.tipoServicio.duracionMin,
        cuadrillas: [{ id: cuadrilla.id, capacidadDiaria: cuadrilla.capacidadDiaria, bloques: cuadrilla.disponibilidades }],
        citas: await citasDelHorizonte(tx, [cuadrilla.id], cita.id, ahora),
      }).find((c) => c.inicio.getTime() === destino.inicio.getTime());
      if (!franja) throw new FranjaNoDisponibleError();

      const actualizada = await tx.cita.update({
        where: { id: cita.id },
        data: { cuadrillaId: cuadrilla.id, inicio: franja.inicio, fin: franja.fin },
      });
      await tx.historialCita.create({
        data: {
          ventaId: cita.ventaId,
          citaId: cita.id,
          accion: cita.cuadrillaId === cuadrilla.id ? "MOVIDA" : "REASIGNADA",
          cuadrillaAnteriorId: cita.cuadrillaId,
          inicioAnterior: cita.inicio,
          finAnterior: cita.fin,
          cuadrillaNuevaId: actualizada.cuadrillaId,
          inicioNuevo: actualizada.inicio,
          finNuevo: actualizada.fin,
          actor: destino.actor,
          motivo: destino.motivo,
        },
      });
      return actualizada;
    }, OPCIONES_TX);
  } catch (error) {
    if (esChoqueDeCita(error)) throw new FranjaNoDisponibleError();
    throw error;
  }
}

// Libera la cita: se elimina, la venta vuelve a CERRADA (pendiente de agenda) y queda el registro.
export async function liberarCita(
  citaId: number,
  { actor, motivo }: Responsable,
  { db = prismaPorDefecto }: Pick<OpcionesAdmin, "db"> = {},
) {
  return db.$transaction(async (tx) => {
    const cita = await bloquearCita(tx, citaId);
    await tx.cita.delete({ where: { id: cita.id } });
    const venta = await tx.venta.update({ where: { id: cita.ventaId }, data: { estado: "CERRADA" } });
    await tx.historialCita.create({
      data: {
        ventaId: cita.ventaId,
        citaId: cita.id,
        accion: "LIBERADA",
        cuadrillaAnteriorId: cita.cuadrillaId,
        inicioAnterior: cita.inicio,
        finAnterior: cita.fin,
        actor,
        motivo,
      },
    });
    return venta;
  }, OPCIONES_TX);
}

// Franjas a las que se puede mover o reasignar la cita, en el orden del motor (más próxima primero).
export async function opcionesDeReprogramacion(
  citaId: number,
  { ahora = new Date(), db = prismaPorDefecto, limite = 300 }: OpcionesAdmin & { limite?: number } = {},
) {
  const cita = await db.cita.findUnique({
    where: { id: citaId },
    include: { venta: { include: { tipoServicio: true } } },
  });
  if (!cita) throw new CitaNoEncontradaError(citaId);

  const cuadrillas = await db.cuadrilla.findMany({
    where: { contratista: { ciudades: { some: { ciudadId: cita.venta.ciudadId } } } },
    include: { disponibilidades: true },
    orderBy: { nombre: "asc" },
  });
  const franjas = calcularCandidatas({
    ahora,
    duracionMin: cita.venta.tipoServicio.duracionMin,
    cuadrillas: cuadrillas.map((c) => ({ id: c.id, capacidadDiaria: c.capacidadDiaria, bloques: c.disponibilidades })),
    citas: await citasDelHorizonte(db, cuadrillas.map((c) => c.id), cita.id, ahora),
  })
    .filter((f) => !(f.cuadrillaId === cita.cuadrillaId && f.inicio.getTime() === cita.inicio.getTime()))
    .slice(0, limite)
    .map(({ cuadrillaId, inicio, fin }) => ({ cuadrillaId, inicio, fin }));

  return {
    cita: { id: cita.id, cuadrillaId: cita.cuadrillaId, inicio: cita.inicio, fin: cita.fin },
    cuadrillas: cuadrillas.map((c) => ({ id: c.id, nombre: c.nombre })),
    franjas,
  };
}
