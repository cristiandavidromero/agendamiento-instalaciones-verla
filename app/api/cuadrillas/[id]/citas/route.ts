import { prisma } from "@/lib/prisma";
import { conManejoDeErrores, idDeRuta, noEncontrado } from "@/api/respuestas";

type Contexto = { params: Promise<{ id: string }> };

// GET /api/cuadrillas/:id/citas — agenda de la cuadrilla en orden cronológico.
export const GET = conManejoDeErrores(async (_solicitud: Request, contexto: Contexto) => {
  const id = await idDeRuta(contexto);
  const cuadrilla = await prisma.cuadrilla.findUnique({
    where: { id },
    include: {
      citas: {
        orderBy: { inicio: "asc" },
        include: { venta: { select: { id: true, tipoServicio: { select: { nombre: true } } } } },
      },
    },
  });
  if (!cuadrilla) throw noEncontrado("Cuadrilla", id);
  return Response.json({ cuadrilla: { id: cuadrilla.id, nombre: cuadrilla.nombre }, citas: cuadrilla.citas });
});
