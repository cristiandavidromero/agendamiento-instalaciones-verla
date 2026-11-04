import { prisma } from "@/lib/prisma";

// Vacía todas las tablas de dominio entre pruebas.
export async function limpiarBD() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE cita, venta, tipo_servicio, disponibilidad_cuadrilla, instalador,
             cuadrilla, contratista_ciudad, contratista, ciudad
    RESTART IDENTITY CASCADE
  `);
}

// Escenario mínimo: una ciudad, un contratista y las cuadrillas pedidas (1 instalador cada una).
export async function crearEscenario({ cuadrillas = 1, capacidadDiaria = 4 } = {}) {
  const ciudad = await prisma.ciudad.create({ data: { nombre: "Bogotá" } });
  const contratista = await prisma.contratista.create({
    data: { nombre: "Contratista A", ciudades: { create: { ciudadId: ciudad.id } } },
  });
  const creadas = [];
  for (let i = 1; i <= cuadrillas; i++) {
    creadas.push(
      await prisma.cuadrilla.create({
        data: {
          nombre: `Cuadrilla ${i}`,
          contratistaId: contratista.id,
          capacidadDiaria,
          instaladores: { create: [{ nombre: `Instalador ${i}` }] },
        },
      }),
    );
  }
  const tipoServicio = await prisma.tipoServicio.create({
    data: { nombre: "Instalación básica", duracionMin: 60 },
  });
  return { ciudad, contratista, cuadrillas: creadas, tipoServicio };
}

export async function crearVenta(ciudadId: number, tipoServicioId: number) {
  return prisma.venta.create({ data: { ciudadId, tipoServicioId } });
}

export const hora = (iso: string) => new Date(iso);
