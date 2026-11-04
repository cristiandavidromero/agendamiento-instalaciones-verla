import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { crearEscenario, crearVenta, hora, limpiarBD } from "./helpers";

describe("restricciones de la BD", () => {
  beforeEach(limpiarBD);
  afterAll(() => prisma.$disconnect());

  async function citaPara(cuadrillaId: number, inicio: string, fin: string) {
    const { ciudadId, tipoServicioId } = (await prisma.venta.findFirst())!;
    const venta = await crearVenta(ciudadId, tipoServicioId);
    return prisma.cita.create({
      data: { ventaId: venta.id, cuadrillaId, inicio: hora(inicio), fin: hora(fin) },
    });
  }

  async function escenarioConUnaVenta(opciones?: Parameters<typeof crearEscenario>[0]) {
    const escenario = await crearEscenario(opciones);
    await crearVenta(escenario.ciudad.id, escenario.tipoServicio.id);
    return escenario;
  }

  describe("cita_sin_solapamiento", () => {
    it("rechaza dos citas solapadas de la misma cuadrilla", async () => {
      const { cuadrillas } = await escenarioConUnaVenta();
      await citaPara(cuadrillas[0].id, "2026-11-05T13:00:00Z", "2026-11-05T14:00:00Z");

      await expect(
        citaPara(cuadrillas[0].id, "2026-11-05T13:30:00Z", "2026-11-05T14:30:00Z"),
      ).rejects.toThrow(/cita_sin_solapamiento/);
    });

    it("rechaza una cita contenida dentro de otra", async () => {
      const { cuadrillas } = await escenarioConUnaVenta();
      await citaPara(cuadrillas[0].id, "2026-11-05T13:00:00Z", "2026-11-05T15:00:00Z");

      await expect(
        citaPara(cuadrillas[0].id, "2026-11-05T13:30:00Z", "2026-11-05T14:00:00Z"),
      ).rejects.toThrow(/cita_sin_solapamiento/);
    });

    it("acepta citas contiguas de la misma cuadrilla (rango [inicio, fin))", async () => {
      const { cuadrillas } = await escenarioConUnaVenta();
      await citaPara(cuadrillas[0].id, "2026-11-05T13:00:00Z", "2026-11-05T14:00:00Z");

      await expect(
        citaPara(cuadrillas[0].id, "2026-11-05T14:00:00Z", "2026-11-05T15:00:00Z"),
      ).resolves.toBeDefined();
    });

    it("acepta citas solapadas en cuadrillas distintas", async () => {
      const { cuadrillas } = await escenarioConUnaVenta({ cuadrillas: 2 });
      await citaPara(cuadrillas[0].id, "2026-11-05T13:00:00Z", "2026-11-05T14:00:00Z");

      await expect(
        citaPara(cuadrillas[1].id, "2026-11-05T13:00:00Z", "2026-11-05T14:00:00Z"),
      ).resolves.toBeDefined();
    });
  });

  it("una venta no puede tener dos citas", async () => {
    const { cuadrillas, ciudad, tipoServicio } = await crearEscenario({ cuadrillas: 2 });
    const venta = await crearVenta(ciudad.id, tipoServicio.id);
    const datos = { ventaId: venta.id, inicio: hora("2026-11-05T13:00:00Z"), fin: hora("2026-11-05T14:00:00Z") };
    await prisma.cita.create({ data: { ...datos, cuadrillaId: cuadrillas[0].id } });

    await expect(
      prisma.cita.create({ data: { ...datos, cuadrillaId: cuadrillas[1].id } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rechaza una cita cuyo fin no es posterior al inicio", async () => {
    const { cuadrillas } = await escenarioConUnaVenta();

    await expect(
      citaPara(cuadrillas[0].id, "2026-11-05T14:00:00Z", "2026-11-05T14:00:00Z"),
    ).rejects.toThrow(/cita_fin_posterior_inicio/);
  });

  it("rechaza una cuadrilla con capacidad diaria 0", async () => {
    await expect(crearEscenario({ capacidadDiaria: 0 })).rejects.toThrow(
      /cuadrilla_capacidad_positiva/,
    );
  });

  it("rechaza un tipo de servicio sin duración", async () => {
    await expect(
      prisma.tipoServicio.create({ data: { nombre: "Vacío", duracionMin: 0 } }),
    ).rejects.toThrow(/tipo_servicio_duracion_positiva/);
  });

  it("rechaza bloques de disponibilidad inválidos", async () => {
    const { cuadrillas } = await crearEscenario();
    const bloque = (diaSemana: number, minutoInicio: number, minutoFin: number) =>
      prisma.disponibilidadCuadrilla.create({
        data: { cuadrillaId: cuadrillas[0].id, diaSemana, minutoInicio, minutoFin },
      });

    await expect(bloque(7, 480, 1020)).rejects.toThrow(/disponibilidad_dia_valido/);
    await expect(bloque(1, 1020, 480)).rejects.toThrow(/disponibilidad_rango_valido/);
    await expect(bloque(1, 480, 1500)).rejects.toThrow(/disponibilidad_rango_valido/);
    await expect(bloque(1, 480, 1020)).resolves.toBeDefined();
  });

  describe("cuadrilla_max_instaladores", () => {
    it("acepta un segundo instalador", async () => {
      const { cuadrillas } = await crearEscenario();

      await expect(
        prisma.instalador.create({ data: { nombre: "Segundo", cuadrillaId: cuadrillas[0].id } }),
      ).resolves.toBeDefined();
    });

    it("rechaza un tercer instalador", async () => {
      const { cuadrillas } = await crearEscenario();
      await prisma.instalador.create({ data: { nombre: "Segundo", cuadrillaId: cuadrillas[0].id } });

      await expect(
        prisma.instalador.create({ data: { nombre: "Tercero", cuadrillaId: cuadrillas[0].id } }),
      ).rejects.toThrow(/cuadrilla_max_instaladores/);
    });

    it("rechaza mover un instalador a una cuadrilla completa", async () => {
      const { cuadrillas } = await crearEscenario({ cuadrillas: 2 });
      await prisma.instalador.create({ data: { nombre: "Segundo", cuadrillaId: cuadrillas[0].id } });
      const delOtra = await prisma.instalador.findFirstOrThrow({
        where: { cuadrillaId: cuadrillas[1].id },
      });

      await expect(
        prisma.instalador.update({ where: { id: delOtra.id }, data: { cuadrillaId: cuadrillas[0].id } }),
      ).rejects.toThrow(/cuadrilla_max_instaladores/);
    });

    it("dos altas concurrentes no superan el límite", async () => {
      const { cuadrillas } = await crearEscenario();
      const alta = (nombre: string) =>
        prisma.instalador.create({ data: { nombre, cuadrillaId: cuadrillas[0].id } });

      const resultados = await Promise.allSettled([alta("B"), alta("C"), alta("D")]);

      expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.instalador.count({ where: { cuadrillaId: cuadrillas[0].id } })).toBe(2);
    });
  });
});
