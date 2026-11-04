// Demo para la exposición: 20 ventas simultáneas por el único cupo libre de una cuadrilla.
// Corre contra la BD de pruebas (agenda_test), que reinicia; la de desarrollo no se toca.
//
//   npm run demo:concurrencia

import { execSync } from "node:child_process";
import "dotenv/config";

const VENTAS = 20;

async function main() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("Falta DATABASE_URL_TEST (ver .env.example)");
  process.env.DATABASE_URL = url; // antes de importar el cliente de Prisma
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: process.env });

  const { prisma } = await import("@/lib/prisma");
  const { buscarCandidatas, reservarPrimeraDisponible } = await import("@/servicios/agendar");
  const { fechaLocal, instanteLocal, sumarDias, diaSemana } = await import("@/dominio/tiempo");
  const { formatoDia, formatoHora } = await import("@/ui/formato");

  // Mañana a las 8:00 (hora de Bogotá) es el único cupo libre: la cuadrilla trabaja solo ese
  // día de la semana de 8:00 a 9:00, y la misma franja de la semana siguiente ya está ocupada.
  const ahora = new Date();
  const manana = sumarDias(fechaLocal(ahora), 1);
  const cupo = { inicio: instanteLocal(manana, 8 * 60), fin: instanteLocal(manana, 9 * 60) };

  async function prepararEscenario() {
    await prisma.$executeRawUnsafe(`
      TRUNCATE cita, venta, tipo_servicio, disponibilidad_cuadrilla, instalador,
               cuadrilla, contratista_ciudad, contratista, ciudad
      RESTART IDENTITY CASCADE`);
    const ciudad = await prisma.ciudad.create({ data: { nombre: "Bogotá" } });
    const tipo = await prisma.tipoServicio.create({ data: { nombre: "Instalación básica", duracionMin: 60 } });
    const contratista = await prisma.contratista.create({
      data: { nombre: "Contratista demo", ciudades: { create: { ciudadId: ciudad.id } } },
    });
    const cuadrilla = await prisma.cuadrilla.create({
      data: {
        nombre: "Cuadrilla demo",
        contratistaId: contratista.id,
        capacidadDiaria: 4,
        instaladores: { create: [{ nombre: "Instalador demo" }] },
        disponibilidades: { create: { diaSemana: diaSemana(manana), minutoInicio: 8 * 60, minutoFin: 9 * 60 } },
      },
    });
    const previa = await prisma.venta.create({ data: { ciudadId: ciudad.id, tipoServicioId: tipo.id } });
    const semanaSiguiente = sumarDias(manana, 7);
    await prisma.cita.create({
      data: {
        ventaId: previa.id,
        cuadrillaId: cuadrilla.id,
        inicio: instanteLocal(semanaSiguiente, 8 * 60),
        fin: instanteLocal(semanaSiguiente, 9 * 60),
      },
    });
    const ventas = await Promise.all(
      Array.from({ length: VENTAS }, () =>
        prisma.venta.create({ data: { ciudadId: ciudad.id, tipoServicioId: tipo.id } }),
      ),
    );
    return ventas.map((v) => v.id);
  }

  async function ronda(titulo: string, bloquearCuadrilla: boolean) {
    const ids = await prepararEscenario();
    // Todas calculan sus candidatas antes de que ninguna reserve: las 20 ven el mismo cupo.
    const busquedas = await Promise.all(ids.map((id) => buscarCandidatas(id, { ahora })));
    const t0 = performance.now();
    const disputa = await Promise.allSettled(
      busquedas.map(({ venta, candidatas }) =>
        reservarPrimeraDisponible(venta.id, candidatas, { bloquearCuadrilla }),
      ),
    );
    const ms = Math.round(performance.now() - t0);
    const resultados = disputa.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const vencidas = disputa.length - resultados.length;

    const [{ n: solapes }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM cita a JOIN cita b
        ON a.cuadrilla_id = b.cuadrilla_id AND a.id < b.id
       AND tstzrange(a.inicio, a.fin, '[)') && tstzrange(b.inicio, b.fin, '[)')`;
    const agendadas = resultados.filter((r) => r.estado === "AGENDADA");
    const choques = resultados.reduce((s, r) => s + r.choques, 0);
    const ganadora = agendadas[0];

    console.log(`\n${titulo}`);
    console.log(`  ${VENTAS} intentos simultáneos en ${ms} ms`);
    console.log(
      `  ${agendadas.length} agendada, ${resultados.length - agendadas.length} sin cupo, ` +
        `${vencidas} transacciones vencidas, ${solapes} solapes`,
    );
    console.log(`  choques y deadlocks atrapados por la BD: ${choques}`);
    if (ganadora?.estado === "AGENDADA") console.log(`  ganó la venta #${ganadora.cita.ventaId}`);
    else console.log("  nadie obtuvo el cupo");
    return { agendadas: agendadas.length, vencidas, solapes };
  }

  console.log(
    `Cupo en disputa: ${formatoDia(cupo.inicio)}, ${formatoHora(cupo.inicio)}–${formatoHora(cupo.fin)} (hora de Bogotá)`,
  );
  const conBloqueo = await ronda("Con SELECT ... FOR UPDATE (diseño final)", true);
  const sinBloqueo = await ronda("Control sin FOR UPDATE (solo la restricción de la BD)", false);
  await prisma.$disconnect();

  // Con bloqueo se exige el resultado exacto; sin él, la BD solo garantiza que no haya solapes.
  const conBloqueoOk = conBloqueo.agendadas === 1 && conBloqueo.vencidas === 0 && conBloqueo.solapes === 0;
  const sinBloqueoOk = sinBloqueo.agendadas <= 1 && sinBloqueo.solapes === 0;
  if (!conBloqueoOk || !sinBloqueoOk) {
    console.error("\nResultado inesperado: revisa la reserva exclusiva.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
