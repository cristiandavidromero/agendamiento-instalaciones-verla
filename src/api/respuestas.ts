// Utilidades comunes de las rutas de la API: formato de errores y manejo centralizado.

import { z, ZodError } from "zod";
import { VentaNoEncontradaError } from "@/servicios/agendar";

// Mensajes de validación en español.
z.config(z.locales.es());

export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorApi";
  }
}

export const noEncontrado = (recurso: string, id: number) =>
  new ErrorApi(404, `${recurso.toUpperCase()}_NO_ENCONTRADA`, `${recurso} ${id} no existe`);

export function respuestaError(status: number, codigo: string, mensaje: string, detalles?: unknown) {
  return Response.json({ error: { codigo, mensaje, ...(detalles ? { detalles } : {}) } }, { status });
}

// Envuelve un handler y traduce los errores conocidos a respuestas HTTP.
export function conManejoDeErrores<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ErrorApi) return respuestaError(error.status, error.codigo, error.message);
      if (error instanceof ZodError) {
        return respuestaError(400, "ENTRADA_INVALIDA", "La solicitud no es válida", z.flattenError(error));
      }
      if (error instanceof VentaNoEncontradaError) {
        return respuestaError(404, "VENTA_NO_ENCONTRADA", error.message);
      }
      console.error(error);
      return respuestaError(500, "ERROR_INTERNO", "Error inesperado");
    }
  };
}

export const esquemaId = z.coerce.number().int().positive();

// Lee y valida el parámetro [id] de una ruta dinámica.
export async function idDeRuta(contexto: { params: Promise<{ id: string }> }) {
  return esquemaId.parse((await contexto.params).id);
}

// Lee el cuerpo JSON; un cuerpo vacío o mal formado se trata como entrada inválida.
export async function cuerpoJson(solicitud: Request): Promise<unknown> {
  try {
    return await solicitud.json();
  } catch {
    throw new ErrorApi(400, "ENTRADA_INVALIDA", "El cuerpo debe ser JSON válido");
  }
}
