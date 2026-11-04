// Formato de fechas para la interfaz, siempre en la hora local de negocio.

import { ZONA_NEGOCIO } from "@/dominio/tiempo";

const dia = new Intl.DateTimeFormat("es-CO", {
  timeZone: ZONA_NEGOCIO,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const hora = new Intl.DateTimeFormat("es-CO", {
  timeZone: ZONA_NEGOCIO,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const aFecha = (valor: Date | string) => (typeof valor === "string" ? new Date(valor) : valor);

// "Jueves, 5 de noviembre"
export const formatoDia = (valor: Date | string) => {
  const texto = dia.format(aFecha(valor));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

// "08:30"
export const formatoHora = (valor: Date | string) => hora.format(aFecha(valor));
