// Prueba central de la exposición: muchas ventas simultáneas compiten por el mismo cupo
// contra PostgreSQL real y nunca hay dos citas cruzadas ni cuadrillas por encima de su capacidad.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  agendarVenta,
  buscarCandidatas,
  reservarPrimeraDisponible,
  type ResultadoAgenda,
} from "@/servicios/agendar";
import { bogota, crearEscenario, crearVenta, limpiarBD, todaLaSemana } from "./helpers";

const VENTAS = 20;
// Miércoles 4 de noviembre de 2026, 7:00 en Bogotá.
const AHORA = bogota("2026-11-04 07:00");
const h = (horas: number) => horas * 60;

async function citasCruzadas() {
  const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM cita a JOIN cita b
      ON a.cuadrilla_id = b.cuadrilla_id AND a.id < b.id
     AND tstzrange(a.inicio, a.fin, '[)') && tstzrange(b.inicio, b.fin, '[)')`;
  return n;
}

async function diasSobreCapacidad() {
  return prisma.$queryRaw<{ cuadrilla_id: number; dia: Date; citas: number }[]>`
    SELECT c.cuadrilla_id, (c.inicio AT TIME ZONE 'America/Bogota')::date AS dia, count(*)::int AS citas
    FROM cita c JOIN cuadrilla q ON q.id = c.cuadrilla_id
    GROUP BY c.cuadrilla_id, dia, q.capacidad_diaria
    HAVING count(*) > q.capacidad_diaria`;
}

const contar = (resultados: ResultadoAgenda[], estado: ResultadoAgenda["estado"]) =>
  resultados.filter((r) => r.estado === estado).length;
const totalChoques = (resultados: ResultadoAgenda[]) => resultados.reduce((s, r) => s + r.choques, 0);

// Una cuadrilla con un único cupo libre en todo el horizonte: miércoles 4, 8:00–9:00.
// (El miércoles 11 está dentro del horizonte, así que se deja ocupado de antemano.)
async function escenarioUnCupo() {
  const escenario = await crearEscenario({
    bloques: [{ diaSemana: 3, minutoInicio: h(8), minutoFin: h(9) }],
  });
  const { ciudad, tipoServicio, cuadrillas } = escenario;
  const previa = await crearVenta(ciudad.id, tipoServicio.id);
  await prisma.cita.create({
    data: {
      ventaId: previa.id,
      cuadrillaId: cuadrillas[0].id,
      inicio: bogota("2026-11-11 08:00"),
      fin: bogota("2026-11-11 09:00"),
    },
  });
  const ventas = [];
  for (let i = 0; i < VENTAS; i++) ventas.push(await crearVenta(ciudad.id, tipoServicio.id));
  return { ...escenario, ventas };
}

// Todas las ventas calculan sus candidatas antes de que ninguna reserve: las 20 ven el
// mismo cupo libre y salen a disputarlo a la vez.
async function disputarElMismoCupo(ventaIds: number[], bloquearCuadrilla: boolean) {
  const busquedas = await Promise.all(ventaIds.map((id) => buscarCandidatas(id, { ahora: AHORA })));
  for (const { candidatas } of busquedas) {
    expect(candidatas.map((c) => c.inicio)).toEqual([bogota("2026-11-04 08:00")]);
  }
  return Promise.allSettled(
    busquedas.map(({ venta, candidatas }) =>
      reservarPrimeraDisponible(venta.id, candidatas, { bloquearCuadrilla }),
    ),
  );
}

const cumplidas = (resultados: PromiseSettledResult<ResultadoAgenda>[]) =>
  resultados.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
const fallidas = (resultados: PromiseSettledResult<ResultadoAgenda>[]) =>
  resultados.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));

describe(`concurrencia: ${VENTAS} ventas simultáneas`, () => {
  beforeEach(limpiarBD);
  afterAll(() => prisma.$disconnect());

  it("por el mismo cupo: solo 1 lo obtiene", async () => {
    const { ventas, cuadrillas } = await escenarioUnCupo();

    const disputa = await disputarElMismoCupo(ventas.map((v) => v.id), true);
    expect(fallidas(disputa)).toEqual([]);
    const resultados = cumplidas(disputa);

    expect(contar(resultados, "AGENDADA")).toBe(1);
    expect(contar(resultados, "SIN_CUPO")).toBe(VENTAS - 1);
    const ganadora = resultados.find((r) => r.estado === "AGENDADA");
    expect(ganadora?.estado === "AGENDADA" && ganadora.cita).toMatchObject({
      cuadrillaId: cuadrillas[0].id,
      inicio: bogota("2026-11-04 08:00"),
    });
    expect(await prisma.cita.count({ where: { inicio: bogota("2026-11-04 08:00") } })).toBe(1);
    expect(await prisma.venta.count({ where: { estado: "CERRADA" } })).toBe(VENTAS - 1);
    expect(await citasCruzadas()).toBe(0);
    // El FOR UPDATE serializa a las 20: las perdedoras descartan el cupo al revalidar,
    // sin llegar a chocar con la restricción de la BD.
    expect(totalChoques(resultados)).toBe(0);
  });

  it("por el mismo cupo de punta a punta con agendarVenta: solo 1 lo obtiene", async () => {
    const { ventas } = await escenarioUnCupo();

    const resultados = await Promise.all(ventas.map((v) => agendarVenta(v.id, { ahora: AHORA })));

    expect(contar(resultados, "AGENDADA")).toBe(1);
    expect(contar(resultados, "SIN_CUPO")).toBe(VENTAS - 1);
    expect(await citasCruzadas()).toBe(0);
  });

  // Sin el bloqueo, las inserciones se esperan entre sí en la restricción de exclusión y
  // PostgreSQL resuelve los deadlocks de uno en uno (deadlock_timeout = 1 s): a veces alguna
  // transacción supera su timeout. Lo que la BD sí garantiza siempre es que no hay solapes.
  it("control sin FOR UPDATE: la restricción de la BD sigue impidiendo el solape", async () => {
    const { ventas } = await escenarioUnCupo();

    const disputa = await disputarElMismoCupo(ventas.map((v) => v.id), false);
    const resultados = cumplidas(disputa);

    for (const error of fallidas(disputa)) {
      expect(String(error)).toMatch(/expired transaction|Transaction already closed/);
    }
    expect(contar(resultados, "AGENDADA")).toBeLessThanOrEqual(1);
    expect(await prisma.cita.count({ where: { inicio: bogota("2026-11-04 08:00") } })).toBe(
      contar(resultados, "AGENDADA"),
    );
    expect(await citasCruzadas()).toBe(0);
    console.info(
      `[control sin FOR UPDATE] agendadas: ${contar(resultados, "AGENDADA")}, ` +
        `choques atrapados por cita_sin_solapamiento: ${totalChoques(resultados)}, ` +
        `transacciones vencidas: ${fallidas(disputa).length}`,
    );
  });

  it("con varios cupos: todas se agendan sin cruces ni exceso de capacidad", async () => {
    const { ciudad, tipoServicio } = await crearEscenario({
      cuadrillas: 3,
      capacidadDiaria: 2,
      bloques: todaLaSemana(h(8), h(12)),
    });
    const ventas = [];
    for (let i = 0; i < VENTAS; i++) ventas.push(await crearVenta(ciudad.id, tipoServicio.id));

    const resultados = await Promise.all(ventas.map((v) => agendarVenta(v.id, { ahora: AHORA })));

    expect(contar(resultados, "AGENDADA")).toBe(VENTAS);
    expect(await prisma.cita.count()).toBe(VENTAS);
    expect(await citasCruzadas()).toBe(0);
    expect(await diasSobreCapacidad()).toEqual([]);
    expect(totalChoques(resultados)).toBe(0);
    // 3 cuadrillas × 2 citas por día = 6 por día: 20 ventas caben en los 4 primeros días.
    const ultima = await prisma.cita.findFirstOrThrow({ orderBy: { inicio: "desc" } });
    expect(ultima.inicio < bogota("2026-11-08 00:00")).toBe(true);
  });
});
