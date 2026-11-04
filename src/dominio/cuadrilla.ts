export const MIN_INSTALADORES = 1;
export const MAX_INSTALADORES = 2;

export class ReglaDeNegocioError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ReglaDeNegocioError";
  }
}

// Cada cuadrilla tiene 1 o 2 instaladores.
export function validarInstaladores(nombres: string[]): void {
  if (nombres.length < MIN_INSTALADORES || nombres.length > MAX_INSTALADORES) {
    throw new ReglaDeNegocioError(
      `Una cuadrilla debe tener entre ${MIN_INSTALADORES} y ${MAX_INSTALADORES} instaladores (recibidos: ${nombres.length})`,
    );
  }
}
