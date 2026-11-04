"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatoDiaCorto, formatoFechaHora, formatoHora } from "@/ui/formato";

const CLAVE_RESPONSABLE = "agenda.responsable";
const MOTIVO_DESACTIVADO = "Escribe primero el responsable del cambio";

export interface CitaAdmin {
  id: number;
  ventaId: number;
  cuadrillaId: number;
  cuadrilla: string;
  ciudad: string;
  servicio: string;
  inicio: string;
  fin: string;
}

export interface VentaPendiente {
  id: number;
  ciudad: string;
  servicio: string;
}

interface Opciones {
  cuadrillas: { id: number; nombre: string }[];
  franjas: { cuadrillaId: number; inicio: string; fin: string }[];
}

type Edicion =
  | { modo: "mover"; citaId: number; opciones: Opciones | null; cuadrillaId: number; inicio: string; motivo: string }
  | { modo: "liberar"; citaId: number; motivo: string };

async function enviar(url: string, cuerpo?: unknown) {
  const respuesta = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error?.mensaje ?? "No se pudo completar la acción");
  return datos;
}

export function BandejaAdmin({
  citas,
  pendientes,
  ciudades,
}: {
  citas: CitaAdmin[];
  pendientes: VentaPendiente[];
  ciudades: string[];
}) {
  const router = useRouter();
  const [responsable, setResponsable] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  // El responsable se recuerda en este navegador para no reescribirlo en cada visita.
  useEffect(() => {
    try {
      setResponsable(localStorage.getItem(CLAVE_RESPONSABLE) ?? "");
    } catch {}
  }, []);
  const cambiarResponsable = (valor: string) => {
    setResponsable(valor);
    try {
      localStorage.setItem(CLAVE_RESPONSABLE, valor);
    } catch {}
  };

  const visibles = useMemo(() => citas.filter((c) => !ciudad || c.ciudad === ciudad), [citas, ciudad]);
  const sinResponsable = responsable.trim().length < 2;

  async function ejecutar(accion: () => Promise<string>) {
    setOcupado(true);
    setAviso(null);
    try {
      const texto = await accion();
      setEdicion(null);
      setAviso({ tipo: "ok", texto });
      router.refresh();
    } catch (e) {
      setAviso({ tipo: "error", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  async function abrirMover(cita: CitaAdmin) {
    setAviso(null);
    setEdicion({ modo: "mover", citaId: cita.id, opciones: null, cuadrillaId: cita.cuadrillaId, inicio: "", motivo: "" });
    const respuesta = await fetch(`/api/citas/${cita.id}/opciones`);
    const opciones: Opciones = await respuesta.json();
    setEdicion((actual) =>
      actual?.modo === "mover" && actual.citaId === cita.id
        ? { ...actual, opciones, inicio: opciones.franjas.find((f) => f.cuadrillaId === actual.cuadrillaId)?.inicio ?? "" }
        : actual,
    );
  }

  const guardarMovimiento = (cita: CitaAdmin, e: Extract<Edicion, { modo: "mover" }>) =>
    ejecutar(async () => {
      const resultado = await enviar(`/api/citas/${cita.id}/reprogramar`, {
        cuadrillaId: e.cuadrillaId,
        inicio: e.inicio,
        actor: responsable,
        motivo: e.motivo || undefined,
      });
      const accion = e.cuadrillaId === cita.cuadrillaId ? "movida" : "reasignada";
      return `Venta #${cita.ventaId} ${accion} a ${resultado.cuadrilla.nombre}, ${formatoFechaHora(resultado.inicio)}.`;
    });

  const confirmarLiberacion = (cita: CitaAdmin, e: Extract<Edicion, { modo: "liberar" }>) =>
    ejecutar(async () => {
      await enviar(`/api/citas/${cita.id}/liberar`, { actor: responsable, motivo: e.motivo || undefined });
      return `Cita de la venta #${cita.ventaId} liberada. La venta quedó pendiente de agenda.`;
    });

  const agendar = (venta: VentaPendiente) =>
    ejecutar(async () => {
      const resultado = await enviar(`/api/ventas/${venta.id}/cerrar`);
      return `Venta #${venta.id} agendada con ${resultado.cita.cuadrilla.nombre}, ${formatoFechaHora(resultado.cita.inicio)}.`;
    });

  return (
    <>
      <div className="tarjeta formulario">
        <label>
          Responsable del cambio
          <input
            value={responsable}
            onChange={(e) => cambiarResponsable(e.target.value)}
            placeholder="Tu nombre"
            maxLength={80}
            className={sinResponsable ? "falta" : undefined}
            aria-describedby="aviso-responsable"
          />
          {sinResponsable && (
            <span id="aviso-responsable" className="aviso-campo">
              Escríbelo para habilitar Mover, Reasignar y Liberar.
            </span>
          )}
        </label>
        <label>
          Ciudad
          <select value={ciudad} onChange={(e) => setCiudad(e.target.value)}>
            <option value="">Todas</option>
            {ciudades.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      {aviso && (
        <p className={aviso.tipo === "ok" ? "resultado" : "error"} role="status">
          {aviso.texto}
        </p>
      )}

      <section className="tarjeta" aria-label="Próximas citas">
        <h2>Próximas citas</h2>
        {sinResponsable && <p className="aviso-campo">Escribe arriba el responsable del cambio para habilitar los botones.</p>}
        {visibles.length === 0 ? (
          <p className="suave">No hay citas próximas.</p>
        ) : (
          <ul className="citas-admin">
            {visibles.map((cita) => {
              const abierta = edicion?.citaId === cita.id ? edicion : null;
              return (
                <li key={cita.id} data-venta={cita.ventaId}>
                  <div className="fila-cita">
                    <span className="cuando">
                      {formatoDiaCorto(cita.inicio)} ·{" "}
                      <time dateTime={cita.inicio}>{formatoHora(cita.inicio)}</time>–{formatoHora(cita.fin)}
                    </span>
                    <span>
                      <strong>{cita.cuadrilla}</strong> · {cita.ciudad}
                    </span>
                    <span className="suave">
                      Venta #{cita.ventaId} · {cita.servicio}
                    </span>
                    <span className="acciones">
                      <button
                        type="button"
                        className="secundario"
                        disabled={sinResponsable || ocupado}
                        aria-busy={ocupado}
                        title={sinResponsable ? MOTIVO_DESACTIVADO : undefined}
                        onClick={() => abrirMover(cita)}
                      >
                        Mover o reasignar
                      </button>
                      <button
                        type="button"
                        className="secundario"
                        disabled={sinResponsable || ocupado}
                        aria-busy={ocupado}
                        title={sinResponsable ? MOTIVO_DESACTIVADO : undefined}
                        onClick={() => setEdicion({ modo: "liberar", citaId: cita.id, motivo: "" })}
                      >
                        Liberar
                      </button>
                    </span>
                  </div>

                  {abierta?.modo === "mover" && (
                    <div className="editor formulario">
                      {!abierta.opciones ? (
                        <p className="suave">Buscando franjas libres…</p>
                      ) : (
                        <>
                          <label>
                            Cuadrilla
                            <select
                              value={abierta.cuadrillaId}
                              onChange={(e) => {
                                const cuadrillaId = Number(e.target.value);
                                const primera = abierta.opciones!.franjas.find((f) => f.cuadrillaId === cuadrillaId);
                                setEdicion({ ...abierta, cuadrillaId, inicio: primera?.inicio ?? "" });
                              }}
                            >
                              {abierta.opciones.cuadrillas.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nombre}
                                  {c.id === cita.cuadrillaId ? " (actual)" : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Nueva franja
                            <select value={abierta.inicio} onChange={(e) => setEdicion({ ...abierta, inicio: e.target.value })}>
                              {abierta.opciones.franjas
                                .filter((f) => f.cuadrillaId === abierta.cuadrillaId)
                                .map((f) => (
                                  <option key={f.inicio} value={f.inicio}>
                                    {formatoDiaCorto(f.inicio)} · {formatoHora(f.inicio)}–{formatoHora(f.fin)}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            Motivo (opcional)
                            <input value={abierta.motivo} onChange={(e) => setEdicion({ ...abierta, motivo: e.target.value })} maxLength={280} />
                          </label>
                          <span className="acciones">
                            <button type="button" disabled={!abierta.inicio || ocupado} aria-busy={ocupado} onClick={() => guardarMovimiento(cita, abierta)}>
                              Guardar cambio
                            </button>
                            <button type="button" className="secundario" onClick={() => setEdicion(null)}>
                              Cancelar
                            </button>
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  {abierta?.modo === "liberar" && (
                    <div className="editor formulario">
                      <label>
                        Motivo de la liberación (opcional)
                        <input value={abierta.motivo} onChange={(e) => setEdicion({ ...abierta, motivo: e.target.value })} maxLength={280} />
                      </label>
                      <span className="acciones">
                        <button type="button" className="peligro" disabled={ocupado} aria-busy={ocupado} onClick={() => confirmarLiberacion(cita, abierta)}>
                          Confirmar liberación
                        </button>
                        <button type="button" className="secundario" onClick={() => setEdicion(null)}>
                          Cancelar
                        </button>
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="tarjeta" aria-label="Ventas pendientes de agenda">
        <h2>Ventas pendientes de agenda</h2>
        {pendientes.length === 0 ? (
          <p className="suave">No hay ventas pendientes.</p>
        ) : (
          <ul className="citas-admin">
            {pendientes.map((venta) => (
              <li key={venta.id} data-venta={venta.id}>
                <div className="fila-cita">
                  <span>
                    <strong>Venta #{venta.id}</strong>
                  </span>
                  <span>{venta.ciudad}</span>
                  <span className="suave">{venta.servicio}</span>
                  <span className="acciones">
                    <button type="button" className="secundario" disabled={ocupado} aria-busy={ocupado} onClick={() => agendar(venta)}>
                      Agendar en la franja más próxima
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
