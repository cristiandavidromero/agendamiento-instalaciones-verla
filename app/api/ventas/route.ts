import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { conManejoDeErrores, cuerpoJson, ErrorApi, esquemaId } from "@/api/respuestas";

const esquemaNuevaVenta = z.object({
  ciudadId: esquemaId,
  tipoServicioId: esquemaId,
});

// POST /api/ventas — registra una venta abierta.
export const POST = conManejoDeErrores(async (solicitud: Request) => {
  const { ciudadId, tipoServicioId } = esquemaNuevaVenta.parse(await cuerpoJson(solicitud));

  const [ciudad, tipoServicio] = await Promise.all([
    prisma.ciudad.findUnique({ where: { id: ciudadId } }),
    prisma.tipoServicio.findUnique({ where: { id: tipoServicioId } }),
  ]);
  if (!ciudad) throw new ErrorApi(422, "CIUDAD_INEXISTENTE", `La ciudad ${ciudadId} no existe`);
  if (!tipoServicio) {
    throw new ErrorApi(422, "TIPO_SERVICIO_INEXISTENTE", `El tipo de servicio ${tipoServicioId} no existe`);
  }

  const venta = await prisma.venta.create({ data: { ciudadId, tipoServicioId } });
  return Response.json(venta, { status: 201 });
});
