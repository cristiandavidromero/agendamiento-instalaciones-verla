"use client";

import { useState, type FormEvent } from "react";
import { formatoDia, formatoHora } from "@/ui/formato";

interface Opcion {
  id: number;
  nombre: string;
}

interface TipoServicio extends Opcion {
  duracionMin: number;
}

type Resultado =
  | {
      estado: "AGENDADA";
      ventaId: number;
      cuadrilla: string;
      inicio: string;
      fin: string;
    }
  | { estado: "SIN_CUPO"; ventaId: number };

async function pedir(url: string, cuerpo?: unknown) {
  const respuesta = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { status: respuesta.status, datos: await respuesta.json() };
}

export function FormularioVenta({
  ciudades,
  tiposServicio,
}: {
  ciudades: Opcion[];
  tiposServicio: TipoServicio[];
}) {
  const [ciudadId, setCiudadId] = useState(ciudades[0]?.id ?? 0);
  const [tipoServicioId, setTipoServicioId] = useState(tiposServicio[0]?.id ?? 0);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Resultado[]>([]);

  async function cerrarVenta(evento: FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const venta = await pedir("/api/ventas", { ciudadId, tipoServicioId });
      if (venta.status !== 201) throw new Error(venta.datos.error?.mensaje ?? "No se pudo crear la venta");

      const cierre = await pedir(`/api/ventas/${venta.datos.id}/cerrar`);
      let resultado: Resultado;
      if (cierre.status === 200) {
        const { cita } = cierre.datos;
        resultado = { estado: "AGENDADA", ventaId: venta.datos.id, cuadrilla: cita.cuadrilla.nombre, inicio: cita.inicio, fin: cita.fin };
      } else if (cierre.status === 409) {
        resultado = { estado: "SIN_CUPO", ventaId: venta.datos.id };
      } else {
        throw new Error(cierre.datos.error?.mensaje ?? "No se pudo cerrar la venta");
      }
      setResultados((anteriores) => [resultado, ...anteriores]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <form className="tarjeta formulario" onSubmit={cerrarVenta}>
        <label>
          Ciudad
          <select value={ciudadId} onChange={(e) => setCiudadId(Number(e.target.value))}>
            {ciudades.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo de servicio
          <select value={tipoServicioId} onChange={(e) => setTipoServicioId(Number(e.target.value))}>
            {tiposServicio.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre} ({t.duracionMin} min)
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={enviando}>
          {enviando ? "Agendando…" : "Cerrar venta y agendar"}
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {resultados.length > 0 && (
        <section className="tarjeta">
          <h2>Ventas cerradas</h2>
          <ul className="resultados" aria-label="Ventas cerradas">
            {resultados.map((r) =>
              r.estado === "AGENDADA" ? (
                <li key={r.ventaId} className="resultado">
                  <strong>Venta #{r.ventaId} agendada</strong> con <span className="cuadrilla">{r.cuadrilla}</span>
                  <br />
                  <span className="dia">{formatoDia(r.inicio)}</span>,{" "}
                  <time className="inicio" dateTime={r.inicio}>
                    {formatoHora(r.inicio)}
                  </time>
                  {" – "}
                  <time className="fin" dateTime={r.fin}>
                    {formatoHora(r.fin)}
                  </time>
                </li>
              ) : (
                <li key={r.ventaId} className="resultado sin-cupo">
                  <strong>Venta #{r.ventaId}: sin cupo</strong> en los próximos 14 días. Quedó cerrada y
                  pendiente de agenda.
                </li>
              ),
            )}
          </ul>
        </section>
      )}
    </>
  );
}
