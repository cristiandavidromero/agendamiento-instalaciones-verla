// Motor de disponibilidad: lógica pura, sin BD. Recibe las cuadrillas de la ciudad
// de la venta y sus citas, y devuelve todas las franjas posibles ordenadas de mejor a peor.
// La reserva (src/servicios/agendar.ts) recorre la lista y se queda con la primera que logre.

import {
  claveDia,
  diaSemana,
  fechaLocal,
  instanteLocal,
  sumarDias,
  ZONA_NEGOCIO,
  type FechaLocal,
} from "./tiempo";

export const DURACION_FRANJA_MIN = 30;
export const HORIZONTE_DIAS = 14;

export interface BloqueSemanal {
  diaSemana: number; // 0 = domingo … 6 = sábado
  minutoInicio: number; // minutos desde la medianoche local; bloque [inicio, fin)
  minutoFin: number;
}

export interface CuadrillaDisponible {
  id: number;
  capacidadDiaria: number;
  bloques: BloqueSemanal[];
}

export interface CitaExistente {
  cuadrillaId: number;
  inicio: Date;
  fin: Date;
}

export interface Candidata {
  cuadrillaId: number;
  inicio: Date;
  fin: Date;
  cargaDia: number;
}

export interface EntradaDisponibilidad {
  ahora: Date;
  duracionMin: number;
  cuadrillas: CuadrillaDisponible[];
  citas: CitaExistente[];
  horizonteDias?: number;
  zona?: string;
}

export const seCruzan = (a: { inicio: Date; fin: Date }, b: { inicio: Date; fin: Date }) =>
  a.inicio < b.fin && b.inicio < a.fin;

// Une los bloques contiguos o solapados de un mismo día para que una instalación pueda cruzarlos.
function bloquesDelDia(bloques: BloqueSemanal[], dia: number): [number, number][] {
  const ordenados = bloques
    .filter((b) => b.diaSemana === dia)
    .map((b): [number, number] => [b.minutoInicio, b.minutoFin])
    .sort((a, b) => a[0] - b[0]);
  const unidos: [number, number][] = [];
  for (const [inicio, fin] of ordenados) {
    const ultimo = unidos.at(-1);
    if (ultimo && inicio <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], fin);
    else unidos.push([inicio, fin]);
  }
  return unidos;
}

export function calcularCandidatas({
  ahora,
  duracionMin,
  cuadrillas,
  citas,
  horizonteDias = HORIZONTE_DIAS,
  zona = ZONA_NEGOCIO,
}: EntradaDisponibilidad): Candidata[] {
  if (!(duracionMin > 0)) throw new RangeError(`Duración inválida: ${duracionMin}`);
  if (!(horizonteDias >= 1)) throw new RangeError(`Horizonte inválido: ${horizonteDias}`);

  const hoy = fechaLocal(ahora, zona);
  const dias: FechaLocal[] = Array.from({ length: horizonteDias }, (_, i) => sumarDias(hoy, i));

  const candidatas: Candidata[] = [];
  const cargaHorizonte = new Map<number, number>();

  for (const cuadrilla of cuadrillas) {
    const propias = citas.filter((c) => c.cuadrillaId === cuadrilla.id);
    const citasPorDia = new Map<string, number>();
    for (const c of propias) {
      const clave = claveDia(fechaLocal(c.inicio, zona));
      citasPorDia.set(clave, (citasPorDia.get(clave) ?? 0) + 1);
    }
    cargaHorizonte.set(
      cuadrilla.id,
      dias.reduce((suma, d) => suma + (citasPorDia.get(claveDia(d)) ?? 0), 0),
    );

    for (const dia of dias) {
      const cargaDia = citasPorDia.get(claveDia(dia)) ?? 0;
      if (cargaDia >= cuadrilla.capacidadDiaria) continue;

      for (const [bloqueInicio, bloqueFin] of bloquesDelDia(cuadrilla.bloques, diaSemana(dia))) {
        for (let m = bloqueInicio; m + duracionMin <= bloqueFin; m += DURACION_FRANJA_MIN) {
          const franja = {
            inicio: instanteLocal(dia, m, zona),
            fin: instanteLocal(dia, m + duracionMin, zona),
          };
          if (franja.inicio < ahora) continue;
          if (propias.some((c) => seCruzan(c, franja))) continue;
          candidatas.push({ cuadrillaId: cuadrilla.id, ...franja, cargaDia });
        }
      }
    }
  }

  // Más próxima primero; si empatan, la cuadrilla con menos carga del día, luego del horizonte, luego id.
  candidatas.sort(
    (a, b) =>
      a.inicio.getTime() - b.inicio.getTime() ||
      a.cargaDia - b.cargaDia ||
      cargaHorizonte.get(a.cuadrillaId)! - cargaHorizonte.get(b.cuadrillaId)! ||
      a.cuadrillaId - b.cuadrillaId,
  );

  return candidatas;
}
