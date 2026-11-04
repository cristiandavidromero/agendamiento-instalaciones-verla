import { prisma } from "@/lib/prisma";
import { conManejoDeErrores, idDeRuta, noEncontrado } from "@/api/respuestas";

type Contexto = { params: Promise<{ id: string }> };

// GET /api/ventas/:id — la venta con su cita y cuadrilla, si ya fue agendada.
export const GET = conManejoDeErrores(async (_solicitud: Request, contexto: Contexto) => {
  const id = await idDeRuta(contexto);
  const venta = await prisma.venta.findUnique({
    where: { id },
    include: {
      ciudad: true,
      tipoServicio: true,
      cita: { include: { cuadrilla: { select: { id: true, nombre: true } } } },
    },
  });
  if (!venta) throw noEncontrado("Venta", id);
  return Response.json(venta);
});
