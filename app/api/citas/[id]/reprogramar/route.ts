import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { reprogramarCita } from "@/servicios/administrar";
import { conManejoDeErrores, cuerpoJson, esquemaId, esquemaResponsable, idDeRuta } from "@/api/respuestas";

type Contexto = { params: Promise<{ id: string }> };

const esquemaReprogramacion = esquemaResponsable.extend({
  cuadrillaId: esquemaId,
  inicio: z.iso.datetime({ offset: true }).transform((valor) => new Date(valor)),
});

// POST /api/citas/:id/reprogramar — mueve la cita (misma cuadrilla) o la reasigna (otra cuadrilla).
// 200 con la cita actualizada; 409 si la franja no está disponible; 422 si la cuadrilla no atiende la ciudad.
export const POST = conManejoDeErrores(async (solicitud: Request, contexto: Contexto) => {
  const citaId = await idDeRuta(contexto);
  const destino = esquemaReprogramacion.parse(await cuerpoJson(solicitud));

  const cita = await reprogramarCita(citaId, destino);
  return Response.json(
    await prisma.cita.findUniqueOrThrow({
      where: { id: cita.id },
      include: { cuadrilla: { select: { id: true, nombre: true } } },
    }),
  );
});
