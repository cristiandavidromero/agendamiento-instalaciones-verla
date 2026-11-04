import { prisma } from "@/lib/prisma";
import { fechaLocal, instanteLocal } from "@/dominio/tiempo";
import { formatoFechaHora } from "@/ui/formato";
import { BandejaAdmin, type CitaAdmin, type VentaPendiente } from "./bandeja-admin";

export const dynamic = "force-dynamic";

const VERBO = { CREADA: "agendó", MOVIDA: "movió", REASIGNADA: "reasignó", LIBERADA: "liberó" } as const;

export default async function Administracion() {
  const desdeHoy = instanteLocal(fechaLocal(new Date()), 0);
  const [citas, pendientes, historial, ciudades] = await Promise.all([
    prisma.cita.findMany({
      where: { fin: { gt: desdeHoy } },
      orderBy: [{ inicio: "asc" }, { cuadrillaId: "asc" }],
      include: {
        cuadrilla: { select: { nombre: true } },
        venta: { include: { ciudad: true, tipoServicio: true } },
      },
    }),
    prisma.venta.findMany({
      where: { estado: "CERRADA" },
      orderBy: { id: "asc" },
      include: { ciudad: true, tipoServicio: true },
    }),
    prisma.historialCita.findMany({
      orderBy: { id: "desc" },
      take: 25,
      include: { cuadrillaAnterior: { select: { nombre: true } }, cuadrillaNueva: { select: { nombre: true } } },
    }),
    prisma.ciudad.findMany({ orderBy: { nombre: "asc" } }),
  ]);

  const citasAdmin: CitaAdmin[] = citas.map((c) => ({
    id: c.id,
    ventaId: c.ventaId,
    cuadrillaId: c.cuadrillaId,
    cuadrilla: c.cuadrilla.nombre,
    ciudad: c.venta.ciudad.nombre,
    servicio: c.venta.tipoServicio.nombre,
    inicio: c.inicio.toISOString(),
    fin: c.fin.toISOString(),
  }));
  const pendientesAdmin: VentaPendiente[] = pendientes.map((v) => ({
    id: v.id,
    ciudad: v.ciudad.nombre,
    servicio: v.tipoServicio.nombre,
  }));

  return (
    <>
      <div>
        <h1>Administración de citas</h1>
        <p className="suave">
          Mover, reasignar o liberar citas. Cada cambio pasa por las mismas reglas que el agendamiento
          automático y queda registrado con su responsable.
        </p>
      </div>

      <BandejaAdmin citas={citasAdmin} pendientes={pendientesAdmin} ciudades={ciudades.map((c) => c.nombre)} />

      <section className="tarjeta" aria-label="Historial de cambios">
        <h2>Historial reciente</h2>
        {historial.length === 0 ? (
          <p className="suave">Todavía no hay cambios registrados.</p>
        ) : (
          <ul className="historial">
            {historial.map((h) => (
              <li key={h.id}>
                <span className="suave">{formatoFechaHora(h.creadoEn)}</span>
                <span>
                  <strong>{h.actor}</strong> {VERBO[h.accion]} la venta #{h.ventaId}
                  {h.inicioAnterior && (
                    <>
                      {" "}
                      · de {h.cuadrillaAnterior?.nombre ?? "—"}, {formatoFechaHora(h.inicioAnterior)}
                    </>
                  )}
                  {h.inicioNuevo && (
                    <>
                      {" "}
                      · {h.inicioAnterior ? "a" : "en"} {h.cuadrillaNueva?.nombre ?? "—"}, {formatoFechaHora(h.inicioNuevo)}
                    </>
                  )}
                  {h.motivo && <span className="suave"> · “{h.motivo}”</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
