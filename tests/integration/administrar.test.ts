import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { agendarVenta } from "@/servicios/agendar";
import {
  CitaNoEncontradaError,
  CuadrillaFueraDeCiudadError,
  FranjaNoDisponibleError,
  liberarCita,
  opcionesDeReprogramacion,
  reprogramarCita,
} from "@/servicios/administrar";
import { bogota, crearCuadrilla, crearEscenario, crearVenta, limpiarBD, todaLaSemana } from "./helpers";

// Miércoles 4 de noviembre de 2026, 7:00 en Bogotá.
const AHORA = bogota("2026-11-04 07:00");
const JORNADA = todaLaSemana(8 * 60, 17 * 60);
const ADMIN = { actor: "Ana (operaciones)", motivo: "Cliente pidió otra hora" };

// Escenario con 2 cuadrillas en Bogotá y una cita agendada en la primera a las 8:00.
async function escenarioConCita(opciones: Parameters<typeof crearEscenario>[0] = {}) {
  const escenario = await crearEscenario({ cuadrillas: 2, bloques: JORNADA, ...opciones });
  const venta = await crearVenta(escenario.ciudad.id, escenario.tipoServicio.id);
  const resultado = await agendarVenta(venta.id, { ahora: AHORA });
  if (resultado.estado !== "AGENDADA") throw new Error("escenario sin cita");
  return { ...escenario, venta, cita: resultado.cita };
}

async function agendarOtra(ciudadId: number, tipoServicioId: number) {
  const venta = await crearVenta(ciudadId, tipoServicioId);
  const r = await agendarVenta(venta.id, { ahora: AHORA });
  if (r.estado !== "AGENDADA") throw new Error("sin cita");
  return r.cita;
}

describe("administración de citas", () => {
  beforeEach(limpiarBD);
  afterAll(() => prisma.$disconnect());

  it("el agendamiento automático deja registro CREADA por el sistema", async () => {
    const { venta, cita } = await escenarioConCita();

    const historial = await prisma.historialCita.findMany({ where: { ventaId: venta.id } });

    expect(historial).toHaveLength(1);
    expect(historial[0]).toMatchObject({ accion: "CREADA", actor: "sistema", citaId: cita.id, inicioNuevo: cita.inicio });
  });

  describe("reprogramarCita", () => {
    it("mueve la cita a otra franja de la misma cuadrilla y registra antes y después", async () => {
      const { cita, cuadrillas } = await escenarioConCita();

      const movida = await reprogramarCita(
        cita.id,
        { cuadrillaId: cuadrillas[0].id, inicio: bogota("2026-11-05 10:00"), ...ADMIN },
        { ahora: AHORA },
      );

      expect(movida).toMatchObject({ inicio: bogota("2026-11-05 10:00"), fin: bogota("2026-11-05 11:00") });
      const ultimo = await prisma.historialCita.findFirstOrThrow({ orderBy: { id: "desc" } });
      expect(ultimo).toMatchObject({
        accion: "MOVIDA",
        actor: ADMIN.actor,
        motivo: ADMIN.motivo,
        cuadrillaAnteriorId: cuadrillas[0].id,
        inicioAnterior: bogota("2026-11-04 08:00"),
        cuadrillaNuevaId: cuadrillas[0].id,
        inicioNuevo: bogota("2026-11-05 10:00"),
      });
    });

    it("permite mover la cita a una franja que se solapa con su propio horario actual", async () => {
      const { cita, cuadrillas } = await escenarioConCita();

      const movida = await reprogramarCita(
        cita.id,
        { cuadrillaId: cuadrillas[0].id, inicio: bogota("2026-11-04 08:30"), ...ADMIN },
        { ahora: AHORA },
      );

      expect(movida.inicio).toEqual(bogota("2026-11-04 08:30"));
    });

    it("reasigna la cita a otra cuadrilla de la ciudad", async () => {
      const { cita, cuadrillas } = await escenarioConCita();

      const reasignada = await reprogramarCita(
        cita.id,
        { cuadrillaId: cuadrillas[1].id, inicio: bogota("2026-11-04 08:00"), ...ADMIN },
        { ahora: AHORA },
      );

      expect(reasignada.cuadrillaId).toBe(cuadrillas[1].id);
      const ultimo = await prisma.historialCita.findFirstOrThrow({ orderBy: { id: "desc" } });
      expect(ultimo).toMatchObject({ accion: "REASIGNADA", cuadrillaAnteriorId: cuadrillas[0].id, cuadrillaNuevaId: cuadrillas[1].id });
    });

    it("rechaza una franja ocupada por otra cita y no cambia nada", async () => {
      const { cita, cuadrillas, ciudad, tipoServicio } = await escenarioConCita({ cuadrillas: 1 });
      const otra = await agendarOtra(ciudad.id, tipoServicio.id); // 9:00 en la misma cuadrilla

      await expect(
        reprogramarCita(cita.id, { cuadrillaId: cuadrillas[0].id, inicio: otra.inicio, ...ADMIN }, { ahora: AHORA }),
      ).rejects.toBeInstanceOf(FranjaNoDisponibleError);
      expect(await prisma.cita.findUnique({ where: { id: cita.id } })).toMatchObject({ inicio: cita.inicio });
      expect(await prisma.historialCita.count({ where: { accion: { not: "CREADA" } } })).toBe(0);
    });

    it.each([
      ["fuera del horario de la cuadrilla", "2026-11-04 17:00"],
      ["donde no cabe la duración completa", "2026-11-04 16:30"],
      ["no alineada a franjas de 30 minutos", "2026-11-04 10:15"],
      ["en el pasado", "2026-11-03 10:00"],
      ["fuera del horizonte de 14 días", "2026-11-18 10:00"],
    ])("rechaza una franja %s", async (_caso, inicio) => {
      const { cita, cuadrillas } = await escenarioConCita();

      await expect(
        reprogramarCita(cita.id, { cuadrillaId: cuadrillas[0].id, inicio: bogota(inicio), ...ADMIN }, { ahora: AHORA }),
      ).rejects.toBeInstanceOf(FranjaNoDisponibleError);
    });

    it("rechaza reasignar a una cuadrilla que no atiende la ciudad de la venta", async () => {
      const { cita } = await escenarioConCita();
      const medellin = await prisma.ciudad.create({ data: { nombre: "Medellín" } });
      const otro = await prisma.contratista.create({
        data: { nombre: "Contratista B", ciudades: { create: { ciudadId: medellin.id } } },
      });
      const ajena = await crearCuadrilla(otro.id, "Ajena", { bloques: JORNADA });

      await expect(
        reprogramarCita(cita.id, { cuadrillaId: ajena.id, inicio: bogota("2026-11-04 08:00"), ...ADMIN }, { ahora: AHORA }),
      ).rejects.toBeInstanceOf(CuadrillaFueraDeCiudadError);
    });

    it("rechaza reasignar a una cuadrilla que llegó a su capacidad ese día", async () => {
      const { cita, cuadrillas, ciudad, tipoServicio } = await escenarioConCita({ capacidadDiaria: 1 });
      await agendarOtra(ciudad.id, tipoServicio.id); // ocupa el único cupo del día de la cuadrilla 2

      await expect(
        reprogramarCita(cita.id, { cuadrillaId: cuadrillas[1].id, inicio: bogota("2026-11-04 14:00"), ...ADMIN }, { ahora: AHORA }),
      ).rejects.toBeInstanceOf(FranjaNoDisponibleError);
    });

    it("permite mover dentro del mismo día aunque la cuadrilla esté en su capacidad", async () => {
      const { cita, cuadrillas } = await escenarioConCita({ cuadrillas: 1, capacidadDiaria: 1 });

      const movida = await reprogramarCita(
        cita.id,
        { cuadrillaId: cuadrillas[0].id, inicio: bogota("2026-11-04 15:00"), ...ADMIN },
        { ahora: AHORA },
      );

      expect(movida.inicio).toEqual(bogota("2026-11-04 15:00"));
    });

    it("falla si la cita no existe", async () => {
      await expect(
        reprogramarCita(999, { cuadrillaId: 1, inicio: bogota("2026-11-04 10:00"), ...ADMIN }, { ahora: AHORA }),
      ).rejects.toBeInstanceOf(CitaNoEncontradaError);
    });

    it("10 movimientos simultáneos al mismo cupo: solo 1 lo obtiene", async () => {
      const { ciudad, tipoServicio, cuadrillas } = await crearEscenario({ bloques: JORNADA });
      const citas = [];
      for (let i = 0; i < 10; i++) citas.push(await agendarOtra(ciudad.id, tipoServicio.id)); // 8:00 … 17:00 ocupado
      const cupo = bogota("2026-11-05 08:00");

      const resultados = await Promise.allSettled(
        citas.map((c) => reprogramarCita(c.id, { cuadrillaId: cuadrillas[0].id, inicio: cupo, ...ADMIN }, { ahora: AHORA })),
      );

      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of resultados) {
        if (r.status === "rejected") expect(r.reason).toBeInstanceOf(FranjaNoDisponibleError);
      }
      expect(await prisma.cita.count({ where: { inicio: cupo } })).toBe(1);
    });
  });

  describe("liberarCita", () => {
    it("elimina la cita, deja la venta pendiente y registra quién la liberó", async () => {
      const { cita, venta } = await escenarioConCita();

      await liberarCita(cita.id, { actor: ADMIN.actor, motivo: "Cliente canceló" });

      expect(await prisma.cita.count()).toBe(0);
      expect(await prisma.venta.findUnique({ where: { id: venta.id } })).toMatchObject({ estado: "CERRADA" });
      const ultimo = await prisma.historialCita.findFirstOrThrow({ orderBy: { id: "desc" } });
      expect(ultimo).toMatchObject({
        accion: "LIBERADA",
        citaId: cita.id,
        actor: ADMIN.actor,
        motivo: "Cliente canceló",
        inicioAnterior: cita.inicio,
        cuadrillaNuevaId: null,
      });
    });

    it("el cupo liberado vuelve a estar disponible y la venta se puede reagendar", async () => {
      const { cita, venta, ciudad, tipoServicio } = await escenarioConCita({ cuadrillas: 1 });
      await liberarCita(cita.id, ADMIN);

      const otra = await agendarOtra(ciudad.id, tipoServicio.id);
      const reagendada = await agendarVenta(venta.id, { ahora: AHORA });

      expect(otra.inicio).toEqual(bogota("2026-11-04 08:00"));
      expect(reagendada.estado === "AGENDADA" && reagendada.cita.inicio).toEqual(bogota("2026-11-04 09:00"));
      const acciones = await prisma.historialCita.findMany({ where: { ventaId: venta.id }, orderBy: { id: "asc" } });
      expect(acciones.map((h) => h.accion)).toEqual(["CREADA", "LIBERADA", "CREADA"]);
    });

    it("falla si la cita no existe", async () => {
      await expect(liberarCita(999, ADMIN)).rejects.toBeInstanceOf(CitaNoEncontradaError);
    });
  });

  describe("opcionesDeReprogramacion", () => {
    it("lista las franjas libres de las cuadrillas de la ciudad sin incluir la franja actual", async () => {
      const { cita, cuadrillas } = await escenarioConCita();

      const { franjas, cuadrillas: disponibles } = await opcionesDeReprogramacion(cita.id, { ahora: AHORA });

      expect(disponibles.map((c) => c.id).sort()).toEqual(cuadrillas.map((c) => c.id).sort());
      expect(franjas[0]).toMatchObject({ cuadrillaId: cuadrillas[1].id, inicio: bogota("2026-11-04 08:00") });
      expect(
        franjas.some((f) => f.cuadrillaId === cita.cuadrillaId && f.inicio.getTime() === cita.inicio.getTime()),
      ).toBe(false);
      // Su propio horario cuenta como libre para moverla media hora.
      expect(franjas.some((f) => f.cuadrillaId === cita.cuadrillaId && f.inicio.getTime() === bogota("2026-11-04 08:30").getTime())).toBe(true);
    });
  });
});
