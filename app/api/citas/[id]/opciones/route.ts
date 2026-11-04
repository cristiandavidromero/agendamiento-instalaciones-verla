import { opcionesDeReprogramacion } from "@/servicios/administrar";
import { conManejoDeErrores, idDeRuta } from "@/api/respuestas";

type Contexto = { params: Promise<{ id: string }> };

// GET /api/citas/:id/opciones — cuadrillas de la ciudad y franjas libres para mover o reasignar.
export const GET = conManejoDeErrores(async (_solicitud: Request, contexto: Contexto) => {
  const citaId = await idDeRuta(contexto);
  return Response.json(await opcionesDeReprogramacion(citaId));
});
