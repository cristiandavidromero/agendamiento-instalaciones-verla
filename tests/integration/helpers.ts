import { prisma } from "@/lib/prisma";
import type { BloqueSemanal } from "@/dominio/disponibilidad";

// Vacía todas las tablas de dominio entre pruebas.
export async function limpiarBD() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE cita, venta, tipo_servicio, disponibilidad_cuadrilla, instalador,
             cuadrilla, contratista_ciudad, contratista, ciudad
    RESTART IDENTITY CASCADE
  `);
}

// Mismo horario todos los días de la semana, en minutos locales.
export const todaLaSemana = (minutoInicio: number, minutoFin: number): BloqueSemanal[] =>
  [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, minutoInicio, minutoFin }));

interface OpcionesCuadrilla {
  capacidadDiaria?: number;
  bloques?: BloqueSemanal[];
}

export async function crearCuadrilla(
  contratistaId: number,
  nombre: string,
  { capacidadDiaria = 4, bloques = [] }: OpcionesCuadrilla = {},
) {
  return prisma.cuadrilla.create({
    data: {
      nombre,
      contratistaId,
      capacidadDiaria,
      instaladores: { create: [{ nombre: `Instalador de ${nombre}` }] },
      disponibilidades: { create: bloques },
    },
  });
}

// Escenario mínimo: una ciudad, un contratista y las cuadrillas pedidas (1 instalador cada una).
export async function crearEscenario({
  cuadrillas = 1,
  capacidadDiaria = 4,
  bloques = [],
  duracionMin = 60,
}: OpcionesCuadrilla & { cuadrillas?: number; duracionMin?: number } = {}) {
  const ciudad = await prisma.ciudad.create({ data: { nombre: "Bogotá" } });
  const contratista = await prisma.contratista.create({
    data: { nombre: "Contratista A", ciudades: { create: { ciudadId: ciudad.id } } },
  });
  const creadas = [];
  for (let i = 1; i <= cuadrillas; i++) {
    creadas.push(await crearCuadrilla(contratista.id, `Cuadrilla ${i}`, { capacidadDiaria, bloques }));
  }
  const tipoServicio = await prisma.tipoServicio.create({
    data: { nombre: "Instalación básica", duracionMin },
  });
  return { ciudad, contratista, cuadrillas: creadas, tipoServicio };
}

export async function crearVenta(ciudadId: number, tipoServicioId: number) {
  return prisma.venta.create({ data: { ciudadId, tipoServicioId } });
}

export const hora = (iso: string) => new Date(iso);

// Instante a partir de una hora local de Bogotá (UTC−5): bogota("2026-11-04 08:00").
export const bogota = (fechaHora: string) => new Date(`${fechaHora.replace(" ", "T")}:00-05:00`);
