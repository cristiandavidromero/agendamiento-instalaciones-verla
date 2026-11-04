import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { agendarVenta } from "@/servicios/agendar";
import { POST as reprogramar } from "../../app/api/citas/[id]/reprogramar/route";
import { POST as liberar } from "../../app/api/citas/[id]/liberar/route";
import { GET as opciones } from "../../app/api/citas/[id]/opciones/route";
import { GET as obtenerVenta } from "../../app/api/ventas/[id]/route";
import { bogota, crearEscenario, crearVenta, limpiarBD, todaLaSemana } from "./helpers";

const AHORA = bogota("2026-11-04 07:00");
const JORNADA = todaLaSemana(8 * 60, 17 * 60);

const post = (ruta: string, cuerpo: unknown) =>
  new Request(`http://localhost${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
const contexto = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

async function escenarioConCita() {
  const escenario = await crearEscenario({ cuadrillas: 2, bloques: JORNADA });
  const venta = await crearVenta(escenario.ciudad.id, escenario.tipoServicio.id);
  const r = await agendarVenta(venta.id, { ahora: AHORA });
  if (r.estado !== "AGENDADA") throw new Error("sin cita");
  return { ...escenario, venta, cita: r.cita };
}

describe("API de administración", () => {
  beforeEach(async () => {
    await limpiarBD();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA);
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => prisma.$disconnect());

  describe("POST /api/citas/:id/reprogramar", () => {
    it("reasigna la cita y responde con la cuadrilla nueva", async () => {
      const { cita, cuadrillas } = await escenarioConCita();

      const respuesta = await reprogramar(
        post(`/api/citas/${cita.id}/reprogramar`, {
          cuadrillaId: cuadrillas[1].id,
          inicio: "2026-11-04T10:00:00-05:00",
          actor: "Ana",
          motivo: "Cambio de zona",
        }),
        contexto(cita.id),
      );

      expect(respuesta.status).toBe(200);
      expect(await respuesta.json()).toMatchObject({
        inicio: "2026-11-04T15:00:00.000Z",
        cuadrilla: { id: cuadrillas[1].id, nombre: "Cuadrilla 2" },
      });
    });

    it("responde 409 si la franja no está disponible", async () => {
      const { cita, cuadrillas } = await escenarioConCita();

      const respuesta = await reprogramar(
        post(`/api/citas/${cita.id}/reprogramar`, { cuadrillaId: cuadrillas[0].id, inicio: "2026-11-04T20:00:00-05:00", actor: "Ana" }),
        contexto(cita.id),
      );

      expect(respuesta.status).toBe(409);
      expect((await respuesta.json()).error.codigo).toBe("FRANJA_NO_DISPONIBLE");
    });

    it("exige el responsable del cambio y una fecha ISO válida", async () => {
      const { cita, cuadrillas } = await escenarioConCita();

      const respuesta = await reprogramar(
        post(`/api/citas/${cita.id}/reprogramar`, { cuadrillaId: cuadrillas[0].id, inicio: "mañana" }),
        contexto(cita.id),
      );
      const cuerpo = await respuesta.json();

      expect(respuesta.status).toBe(400);
      expect(Object.keys(cuerpo.error.detalles.fieldErrors)).toEqual(expect.arrayContaining(["actor", "inicio"]));
    });

    it("responde 404 si la cita no existe", async () => {
      const respuesta = await reprogramar(
        post("/api/citas/999/reprogramar", { cuadrillaId: 1, inicio: "2026-11-04T10:00:00-05:00", actor: "Ana" }),
        contexto(999),
      );

      expect(respuesta.status).toBe(404);
      expect((await respuesta.json()).error.codigo).toBe("CITA_NO_ENCONTRADA");
    });
  });

  describe("POST /api/citas/:id/liberar", () => {
    it("libera la cita y la venta queda pendiente", async () => {
      const { cita, venta } = await escenarioConCita();

      const respuesta = await liberar(post(`/api/citas/${cita.id}/liberar`, { actor: "Ana", motivo: "Cancelación" }), contexto(cita.id));

      expect(respuesta.status).toBe(200);
      expect((await respuesta.json()).venta).toMatchObject({ id: venta.id, estado: "CERRADA" });
      expect(await prisma.cita.count()).toBe(0);
    });
  });

  describe("GET /api/citas/:id/opciones", () => {
    it("devuelve las cuadrillas de la ciudad y las franjas libres", async () => {
      const { cita, cuadrillas } = await escenarioConCita();

      const respuesta = await opciones(new Request(`http://localhost/api/citas/${cita.id}/opciones`), contexto(cita.id));
      const cuerpo = await respuesta.json();

      expect(respuesta.status).toBe(200);
      expect(cuerpo.cuadrillas.map((c: { nombre: string }) => c.nombre)).toEqual(["Cuadrilla 1", "Cuadrilla 2"]);
      expect(cuerpo.franjas[0]).toMatchObject({ cuadrillaId: cuadrillas[1].id, inicio: "2026-11-04T13:00:00.000Z" });
    });
  });

  it("GET /api/ventas/:id incluye el historial con nombres de cuadrilla", async () => {
    const { cita, venta, cuadrillas } = await escenarioConCita();
    await reprogramar(
      post(`/api/citas/${cita.id}/reprogramar`, { cuadrillaId: cuadrillas[1].id, inicio: "2026-11-04T09:00:00-05:00", actor: "Ana" }),
      contexto(cita.id),
    );

    const respuesta = await obtenerVenta(new Request(`http://localhost/api/ventas/${venta.id}`), contexto(venta.id));
    const { historial } = await respuesta.json();

    expect(historial).toMatchObject([
      { accion: "CREADA", actor: "sistema", cuadrillaNueva: { nombre: "Cuadrilla 1" } },
      { accion: "REASIGNADA", actor: "Ana", cuadrillaAnterior: { nombre: "Cuadrilla 1" }, cuadrillaNueva: { nombre: "Cuadrilla 2" } },
    ]);
  });
});
