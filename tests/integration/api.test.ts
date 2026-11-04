import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as crearVentaHttp } from "../../app/api/ventas/route";
import { GET as obtenerVenta } from "../../app/api/ventas/[id]/route";
import { POST as cerrarVenta } from "../../app/api/ventas/[id]/cerrar/route";
import { GET as citasDeCuadrilla } from "../../app/api/cuadrillas/[id]/citas/route";
import { bogota, crearEscenario, crearVenta, limpiarBD, todaLaSemana } from "./helpers";

const JORNADA = todaLaSemana(8 * 60, 17 * 60);

const post = (cuerpo: unknown) =>
  new Request("http://localhost/api/ventas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
const vacia = (ruta: string, method = "GET") => new Request(`http://localhost${ruta}`, { method });
const contexto = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("API", () => {
  beforeEach(async () => {
    await limpiarBD();
    // Reloj fijo: miércoles 4 de noviembre de 2026, 7:00 en Bogotá. Solo se falsea Date.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(bogota("2026-11-04 07:00"));
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => prisma.$disconnect());

  describe("POST /api/ventas", () => {
    it("crea una venta abierta", async () => {
      const { ciudad, tipoServicio } = await crearEscenario();

      const respuesta = await crearVentaHttp(post({ ciudadId: ciudad.id, tipoServicioId: tipoServicio.id }));

      expect(respuesta.status).toBe(201);
      expect(await respuesta.json()).toMatchObject({ ciudadId: ciudad.id, estado: "ABIERTA" });
    });

    it("rechaza un cuerpo inválido con los detalles del error", async () => {
      const respuesta = await crearVentaHttp(post({ ciudadId: "x" }));
      const cuerpo = await respuesta.json();

      expect(respuesta.status).toBe(400);
      expect(cuerpo.error.codigo).toBe("ENTRADA_INVALIDA");
      expect(Object.keys(cuerpo.error.detalles.fieldErrors)).toEqual(
        expect.arrayContaining(["ciudadId", "tipoServicioId"]),
      );
      expect(cuerpo.error.detalles.fieldErrors.ciudadId[0]).toMatch(/[Ee]ntrada inválida|Se esperaba/);
    });

    it("rechaza un cuerpo que no es JSON", async () => {
      const respuesta = await crearVentaHttp(post("{no es json"));

      expect(respuesta.status).toBe(400);
    });

    it("rechaza una ciudad inexistente", async () => {
      const { tipoServicio } = await crearEscenario();

      const respuesta = await crearVentaHttp(post({ ciudadId: 999, tipoServicioId: tipoServicio.id }));

      expect(respuesta.status).toBe(422);
      expect((await respuesta.json()).error.codigo).toBe("CIUDAD_INEXISTENTE");
    });
  });

  describe("POST /api/ventas/:id/cerrar", () => {
    it("agenda la venta en la franja más próxima", async () => {
      const { ciudad, tipoServicio, cuadrillas } = await crearEscenario({ bloques: JORNADA });
      const venta = await crearVenta(ciudad.id, tipoServicio.id);

      const respuesta = await cerrarVenta(vacia(`/api/ventas/${venta.id}/cerrar`, "POST"), contexto(venta.id));

      expect(respuesta.status).toBe(200);
      expect(await respuesta.json()).toMatchObject({
        estado: "AGENDADA",
        cita: {
          ventaId: venta.id,
          inicio: "2026-11-04T13:00:00.000Z",
          fin: "2026-11-04T14:00:00.000Z",
          cuadrilla: { id: cuadrillas[0].id, nombre: "Cuadrilla 1" },
        },
      });
    });

    it("cerrar dos veces devuelve la misma cita", async () => {
      const { ciudad, tipoServicio } = await crearEscenario({ bloques: JORNADA });
      const venta = await crearVenta(ciudad.id, tipoServicio.id);
      const cerrar = () => cerrarVenta(vacia(`/api/ventas/${venta.id}/cerrar`, "POST"), contexto(venta.id));

      const primera = await (await cerrar()).json();
      const segunda = await cerrar();

      expect(segunda.status).toBe(200);
      expect((await segunda.json()).cita.id).toBe(primera.cita.id);
      expect(await prisma.cita.count()).toBe(1);
    });

    it("responde 409 cuando no hay cupo y deja la venta cerrada", async () => {
      const { ciudad, tipoServicio } = await crearEscenario({ bloques: [] });
      const venta = await crearVenta(ciudad.id, tipoServicio.id);

      const respuesta = await cerrarVenta(vacia(`/api/ventas/${venta.id}/cerrar`, "POST"), contexto(venta.id));

      expect(respuesta.status).toBe(409);
      expect((await respuesta.json()).error.codigo).toBe("SIN_CUPO");
      expect(await prisma.venta.findUnique({ where: { id: venta.id } })).toMatchObject({ estado: "CERRADA" });
    });

    it("responde 404 si la venta no existe", async () => {
      const respuesta = await cerrarVenta(vacia("/api/ventas/999/cerrar", "POST"), contexto(999));

      expect(respuesta.status).toBe(404);
      expect((await respuesta.json()).error.codigo).toBe("VENTA_NO_ENCONTRADA");
    });

    it("responde 400 si el id no es un entero positivo", async () => {
      const respuesta = await cerrarVenta(vacia("/api/ventas/abc/cerrar", "POST"), contexto("abc"));

      expect(respuesta.status).toBe(400);
    });
  });

  describe("GET /api/ventas/:id", () => {
    it("devuelve la venta con su cita y cuadrilla", async () => {
      const { ciudad, tipoServicio } = await crearEscenario({ bloques: JORNADA });
      const venta = await crearVenta(ciudad.id, tipoServicio.id);
      await cerrarVenta(vacia(`/api/ventas/${venta.id}/cerrar`, "POST"), contexto(venta.id));

      const respuesta = await obtenerVenta(vacia(`/api/ventas/${venta.id}`), contexto(venta.id));

      expect(respuesta.status).toBe(200);
      expect(await respuesta.json()).toMatchObject({
        id: venta.id,
        estado: "AGENDADA",
        ciudad: { nombre: "Bogotá" },
        tipoServicio: { duracionMin: 60 },
        cita: { cuadrilla: { nombre: "Cuadrilla 1" } },
      });
    });

    it("responde 404 si la venta no existe", async () => {
      const respuesta = await obtenerVenta(vacia("/api/ventas/999"), contexto(999));

      expect(respuesta.status).toBe(404);
    });
  });

  describe("GET /api/cuadrillas/:id/citas", () => {
    it("lista las citas de la cuadrilla en orden cronológico", async () => {
      const { ciudad, tipoServicio, cuadrillas } = await crearEscenario({ bloques: JORNADA });
      for (let i = 0; i < 3; i++) {
        const venta = await crearVenta(ciudad.id, tipoServicio.id);
        await cerrarVenta(vacia(`/api/ventas/${venta.id}/cerrar`, "POST"), contexto(venta.id));
      }

      const respuesta = await citasDeCuadrilla(vacia(`/api/cuadrillas/${cuadrillas[0].id}/citas`), contexto(cuadrillas[0].id));
      const { cuadrilla, citas } = await respuesta.json();

      expect(respuesta.status).toBe(200);
      expect(cuadrilla.nombre).toBe("Cuadrilla 1");
      expect(citas.map((c: { inicio: string }) => c.inicio)).toEqual([
        "2026-11-04T13:00:00.000Z",
        "2026-11-04T14:00:00.000Z",
        "2026-11-04T15:00:00.000Z",
      ]);
      expect(citas[0].venta.tipoServicio.nombre).toBe("Instalación básica");
    });

    it("responde 404 si la cuadrilla no existe", async () => {
      const respuesta = await citasDeCuadrilla(vacia("/api/cuadrillas/999/citas"), contexto(999));

      expect(respuesta.status).toBe(404);
      expect((await respuesta.json()).error.codigo).toBe("CUADRILLA_NO_ENCONTRADA");
    });
  });
});
