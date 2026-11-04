import { liberarCita } from "@/servicios/administrar";
import { conManejoDeErrores, cuerpoJson, esquemaResponsable, idDeRuta } from "@/api/respuestas";

type Contexto = { params: Promise<{ id: string }> };

// POST /api/citas/:id/liberar — elimina la cita y deja la venta pendiente de agenda.
export const POST = conManejoDeErrores(async (solicitud: Request, contexto: Contexto) => {
  const citaId = await idDeRuta(contexto);
  const responsable = esquemaResponsable.parse(await cuerpoJson(solicitud));

  const venta = await liberarCita(citaId, responsable);
  return Response.json({ venta });
});
