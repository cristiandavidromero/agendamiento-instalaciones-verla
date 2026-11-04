import { prisma } from "@/lib/prisma";
import { agendarVenta } from "@/servicios/agendar";
import { conManejoDeErrores, idDeRuta, respuestaError } from "@/api/respuestas";

type Contexto = { params: Promise<{ id: string }> };

// POST /api/ventas/:id/cerrar — cierra la venta y la agenda automáticamente.
// 200 con la cita asignada (también si ya estaba agendada); 409 si no hay cupo en el horizonte.
export const POST = conManejoDeErrores(async (_solicitud: Request, contexto: Contexto) => {
  const ventaId = await idDeRuta(contexto);
  const resultado = await agendarVenta(ventaId);

  if (resultado.estado === "SIN_CUPO") {
    return respuestaError(409, "SIN_CUPO", "No hay cupo disponible en los próximos 14 días");
  }

  const cita = await prisma.cita.findUniqueOrThrow({
    where: { id: resultado.cita.id },
    include: { cuadrilla: { select: { id: true, nombre: true } } },
  });
  return Response.json({ estado: "AGENDADA", cita });
});
