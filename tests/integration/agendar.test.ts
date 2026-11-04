import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  agendarVenta,
  buscarCandidatas,
  esBloqueoMutuo,
  esChoqueDeCita,
  reservarPrimeraDisponible,
  VentaNoEncontradaError,
} from "@/servicios/agendar";
import { bogota, crearCuadrilla, crearEscenario, crearVenta, limpiarBD, todaLaSemana } from "./helpers";

// Miércoles 4 de noviembre de 2026, 7:00 en Bogotá.
const AHORA = bogota("2026-11-04 07:00");
const h = (horas: number) => horas * 60;
const JORNADA = todaLaSemana(h(8), h(17));

async function citaDirecta(cuadrillaId: number, ciudadId: number, tipoServicioId: number, inicio: string, fin: string) {
  const venta = await crearVenta(ciudadId, tipoServicioId);
  return prisma.cita.create({
    data: { ventaId: venta.id, cuadrillaId, inicio: bogota(inicio), fin: bogota(fin) },
  });
}

describe("agendarVenta", () => {
  beforeEach(limpiarBD);
  afterAll(() => prisma.$disconnect());

  it("asigna la franja más próxima de una cuadrilla de la ciudad de la venta", async () => {
    const { ciudad, cuadrillas, tipoServicio } = await crearEscenario({ bloques: JORNADA });
    // Medellín tiene una cuadrilla libre desde las 7:00, pero no atiende Bogotá.
    const medellin = await prisma.ciudad.create({ data: { nombre: "Medellín" } });
    const otro = await prisma.contratista.create({
      data: { nombre: "Contratista B", ciudades: { create: { ciudadId: medellin.id } } },
    });
    await crearCuadrilla(otro.id, "Madrugadora", { bloques: todaLaSemana(h(7), h(17)) });
    const venta = await crearVenta(ciudad.id, tipoServicio.id);

    const resultado = await agendarVenta(venta.id, { ahora: AHORA });

    expect(resultado.estado).toBe("AGENDADA");
    if (resultado.estado !== "AGENDADA") return;
    expect(resultado.cita).toMatchObject({
      cuadrillaId: cuadrillas[0].id,
      inicio: bogota("2026-11-04 08:00"),
      fin: bogota("2026-11-04 09:00"),
    });
    expect(await prisma.venta.findUnique({ where: { id: venta.id } })).toMatchObject({ estado: "AGENDADA" });
  });

  it("dos ventas seguidas toman franjas consecutivas", async () => {
    const { ciudad, tipoServicio } = await crearEscenario({ bloques: JORNADA });
    const a = await agendarVenta((await crearVenta(ciudad.id, tipoServicio.id)).id, { ahora: AHORA });
    const b = await agendarVenta((await crearVenta(ciudad.id, tipoServicio.id)).id, { ahora: AHORA });

    expect(a.estado === "AGENDADA" && a.cita.inicio).toEqual(bogota("2026-11-04 08:00"));
    expect(b.estado === "AGENDADA" && b.cita.inicio).toEqual(bogota("2026-11-04 09:00"));
  });

  it("en empate de franja asigna la cuadrilla con menos carga", async () => {
    const { ciudad, cuadrillas, tipoServicio } = await crearEscenario({ cuadrillas: 2, bloques: JORNADA });
    await citaDirecta(cuadrillas[0].id, ciudad.id, tipoServicio.id, "2026-11-04 15:00", "2026-11-04 16:00");
    const venta = await crearVenta(ciudad.id, tipoServicio.id);

    const resultado = await agendarVenta(venta.id, { ahora: AHORA });

    expect(resultado.estado === "AGENDADA" && resultado.cita.cuadrillaId).toBe(cuadrillas[1].id);
  });

  it("respeta la capacidad diaria de la cuadrilla", async () => {
    const { ciudad, cuadrillas, tipoServicio } = await crearEscenario({ capacidadDiaria: 1, bloques: JORNADA });
    await citaDirecta(cuadrillas[0].id, ciudad.id, tipoServicio.id, "2026-11-04 15:00", "2026-11-04 16:00");
    const venta = await crearVenta(ciudad.id, tipoServicio.id);

    const resultado = await agendarVenta(venta.id, { ahora: AHORA });

    expect(resultado.estado === "AGENDADA" && resultado.cita.inicio).toEqual(bogota("2026-11-05 08:00"));
  });

  it("si la franja se ocupó entre el cálculo y la reserva, toma la siguiente", async () => {
    const { ciudad, cuadrillas, tipoServicio } = await crearEscenario({ bloques: JORNADA });
    const venta = await crearVenta(ciudad.id, tipoServicio.id);
    const { candidatas } = await buscarCandidatas(venta.id, { ahora: AHORA });

    // Otra venta se queda con las 8:00 después de calcular las candidatas.
    await citaDirecta(cuadrillas[0].id, ciudad.id, tipoServicio.id, "2026-11-04 08:00", "2026-11-04 09:00");
    const resultado = await reservarPrimeraDisponible(venta.id, candidatas);

    expect(resultado.estado).toBe("AGENDADA");
    if (resultado.estado !== "AGENDADA") return;
    expect(resultado.cita.inicio).toEqual(bogota("2026-11-04 09:00"));
    expect(resultado.intentos).toBe(3); // 8:00 y 8:30 se descartan al revalidar
  });

  it("si la cuadrilla llenó su capacidad entre el cálculo y la reserva, pasa al día siguiente", async () => {
    const { ciudad, cuadrillas, tipoServicio } = await crearEscenario({ capacidadDiaria: 1, bloques: JORNADA });
    const venta = await crearVenta(ciudad.id, tipoServicio.id);
    const { candidatas } = await buscarCandidatas(venta.id, { ahora: AHORA });

    await citaDirecta(cuadrillas[0].id, ciudad.id, tipoServicio.id, "2026-11-04 16:00", "2026-11-04 17:00");
    const resultado = await reservarPrimeraDisponible(venta.id, candidatas);

    expect(resultado.estado === "AGENDADA" && resultado.cita.inicio).toEqual(bogota("2026-11-05 08:00"));
  });

  it("sin disponibilidad en el horizonte devuelve SIN_CUPO y deja la venta cerrada", async () => {
    const { ciudad, tipoServicio } = await crearEscenario({ bloques: [] });
    const venta = await crearVenta(ciudad.id, tipoServicio.id);

    const resultado = await agendarVenta(venta.id, { ahora: AHORA });

    expect(resultado.estado).toBe("SIN_CUPO");
    expect(await prisma.cita.count()).toBe(0);
    expect(await prisma.venta.findUnique({ where: { id: venta.id } })).toMatchObject({ estado: "CERRADA" });
  });

  it("sin cuadrillas en la ciudad devuelve SIN_CUPO", async () => {
    const { tipoServicio } = await crearEscenario({ bloques: JORNADA });
    const sinCobertura = await prisma.ciudad.create({ data: { nombre: "Cali" } });
    const venta = await crearVenta(sinCobertura.id, tipoServicio.id);

    expect((await agendarVenta(venta.id, { ahora: AHORA })).estado).toBe("SIN_CUPO");
  });

  it("es idempotente: una venta ya agendada conserva su cita", async () => {
    const { ciudad, tipoServicio } = await crearEscenario({ bloques: JORNADA });
    const venta = await crearVenta(ciudad.id, tipoServicio.id);

    const primera = await agendarVenta(venta.id, { ahora: AHORA });
    const segunda = await agendarVenta(venta.id, { ahora: bogota("2026-11-04 12:00") });

    expect(segunda).toMatchObject({ estado: "AGENDADA", intentos: 0 });
    expect(primera.estado === "AGENDADA" && segunda.estado === "AGENDADA" && segunda.cita.id).toBe(
      primera.estado === "AGENDADA" && primera.cita.id,
    );
    expect(await prisma.cita.count()).toBe(1);
  });

  it("falla si la venta no existe", async () => {
    await expect(agendarVenta(999, { ahora: AHORA })).rejects.toBeInstanceOf(VentaNoEncontradaError);
  });
});

describe("esChoqueDeCita", () => {
  beforeEach(limpiarBD);

  it("reconoce la violación de la restricción de exclusión y no otros errores", async () => {
    const { ciudad, cuadrillas, tipoServicio } = await crearEscenario();
    await citaDirecta(cuadrillas[0].id, ciudad.id, tipoServicio.id, "2026-11-04 08:00", "2026-11-04 09:00");

    const choque = await citaDirecta(cuadrillas[0].id, ciudad.id, tipoServicio.id, "2026-11-04 08:30", "2026-11-04 09:30").catch((e) => e);
    const otro = await prisma.tipoServicio.create({ data: { nombre: "x", duracionMin: 0 } }).catch((e) => e);

    expect(esChoqueDeCita(choque)).toBe(true);
    expect(esChoqueDeCita(otro)).toBe(false);
  });
});

describe("esBloqueoMutuo", () => {
  it("reconoce el deadlock de PostgreSQL y el código P2034 de Prisma", () => {
    const deadlock = new Error('PostgresError { code: "40P01", message: "deadlock detected" }');
    const p2034 = new Prisma.PrismaClientKnownRequestError("write conflict or deadlock", {
      code: "P2034",
      clientVersion: Prisma.prismaVersion.client,
    });

    expect(esBloqueoMutuo(deadlock)).toBe(true);
    expect(esBloqueoMutuo(p2034)).toBe(true);
    expect(esBloqueoMutuo(new Error("cita_sin_solapamiento"))).toBe(false);
  });
});
