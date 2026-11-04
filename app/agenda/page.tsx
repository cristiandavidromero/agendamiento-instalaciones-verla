import { prisma } from "@/lib/prisma";
import { claveDia, fechaLocal, instanteLocal } from "@/dominio/tiempo";
import { formatoDia, formatoHora } from "@/ui/formato";

export const dynamic = "force-dynamic";

export default async function Agenda() {
  const desdeHoy = instanteLocal(fechaLocal(new Date()), 0);
  const cuadrillas = await prisma.cuadrilla.findMany({
    orderBy: [{ contratista: { nombre: "asc" } }, { nombre: "asc" }],
    include: {
      contratista: { include: { ciudades: { include: { ciudad: true } } } },
      citas: {
        where: { fin: { gt: desdeHoy } },
        orderBy: { inicio: "asc" },
        include: { venta: { include: { tipoServicio: true } } },
      },
    },
  });

  return (
    <>
      <div>
        <h1>Agenda por cuadrilla</h1>
        <p className="suave">Citas desde hoy, agrupadas por día (hora de Bogotá).</p>
      </div>
      <div className="agenda">
        {cuadrillas.map((cuadrilla) => {
          const porDia = Map.groupBy(cuadrilla.citas, (c) => claveDia(fechaLocal(c.inicio)));
          return (
            <section key={cuadrilla.id} className="tarjeta" aria-label={cuadrilla.nombre}>
              <h2>{cuadrilla.nombre}</h2>
              <p className="suave">
                {cuadrilla.contratista.nombre} · {cuadrilla.contratista.ciudades.map((c) => c.ciudad.nombre).join(", ")} ·{" "}
                {cuadrilla.capacidadDiaria} citas/día
              </p>
              {porDia.size === 0 && <p className="suave">Sin citas próximas.</p>}
              {[...porDia.values()].map((citas) => (
                <div key={citas[0].id}>
                  <h3>{formatoDia(citas[0].inicio)}</h3>
                  <ul>
                    {citas.map((cita) => (
                      <li key={cita.id}>
                        <time dateTime={cita.inicio.toISOString()}>
                          {formatoHora(cita.inicio)}–{formatoHora(cita.fin)}
                        </time>
                        <span>
                          Venta #{cita.ventaId} · {cita.venta.tipoServicio.nombre}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
