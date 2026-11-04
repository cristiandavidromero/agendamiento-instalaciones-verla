import { prisma } from "@/lib/prisma";
import { FormularioVenta } from "./formulario-venta";

export const dynamic = "force-dynamic";

export default async function Inicio() {
  const [ciudades, tiposServicio] = await Promise.all([
    prisma.ciudad.findMany({ orderBy: { nombre: "asc" } }),
    prisma.tipoServicio.findMany({ orderBy: { duracionMin: "asc" } }),
  ]);

  return (
    <>
      <div>
        <h1>Cerrar venta</h1>
        <p className="suave">
          Al cerrar la venta se asigna automáticamente la cuadrilla y la franja más próxima de los
          próximos 14 días.
        </p>
      </div>
      <FormularioVenta ciudades={ciudades} tiposServicio={tiposServicio} />
    </>
  );
}
