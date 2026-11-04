// Conversión entre instantes (UTC) y fecha/hora local de negocio, sin dependencias.
// Usa Intl, así que también es correcta en zonas con horario de verano.

export const ZONA_NEGOCIO = "America/Bogota";

export interface FechaLocal {
  anio: number;
  mes: number; // 1–12
  dia: number;
}

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(zona: string) {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zona,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formateadores.set(zona, f);
  }
  return f;
}

function partesLocales(instante: Date, zona: string) {
  const p = Object.fromEntries(
    formateador(zona)
      .formatToParts(instante)
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, Number(x.value)]),
  );
  return { anio: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute, segundo: p.second };
}

// Milisegundos que la hora local va por delante de UTC en ese instante (Bogotá: −5 h).
function desfase(instante: Date, zona: string): number {
  const p = partesLocales(instante, zona);
  const comoUTC = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUTC - Math.floor(instante.getTime() / 1000) * 1000;
}

export function fechaLocal(instante: Date, zona = ZONA_NEGOCIO): FechaLocal {
  const { anio, mes, dia } = partesLocales(instante, zona);
  return { anio, mes, dia };
}

export function claveDia({ anio, mes, dia }: FechaLocal): string {
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function sumarDias({ anio, mes, dia }: FechaLocal, dias: number): FechaLocal {
  const d = new Date(Date.UTC(anio, mes - 1, dia + dias));
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

// 0 = domingo … 6 = sábado
export function diaSemana({ anio, mes, dia }: FechaLocal): number {
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
}

// Instante UTC que corresponde a `minutos` desde la medianoche local de `fecha`.
export function instanteLocal(fecha: FechaLocal, minutos: number, zona = ZONA_NEGOCIO): Date {
  const base = Date.UTC(fecha.anio, fecha.mes - 1, fecha.dia) + minutos * 60_000;
  const aproximado = base - desfase(new Date(base), zona);
  return new Date(base - desfase(new Date(aproximado), zona));
}
