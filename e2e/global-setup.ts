// Prepara la BD de pruebas para los E2E con un escenario determinista:
// una cuadrilla disponible las 24 h (la franja depende solo del reloj real) y una ciudad sin cobertura.

import { execSync } from "node:child_process";
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

export const CIUDAD_E2E = "Ciudad E2E";
export const CIUDAD_SIN_COBERTURA = "Sin cobertura";
export const CUADRILLA_E2E = "Cuadrilla E2E";
export const CIUDAD_ADMIN_E2E = "Ciudad Admin E2E";
export const CUADRILLA_ADMIN_E2E = "Cuadrilla Admin E2E";
export const SERVICIO_E2E = "Instalación E2E";

export default async function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("Falta DATABASE_URL_TEST (ver .env.example)");
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await prisma.$executeRawUnsafe(`
      TRUNCATE historial_cita, cita, venta, tipo_servicio, disponibilidad_cuadrilla, instalador,
               cuadrilla, contratista_ciudad, contratista, ciudad
      RESTART IDENTITY CASCADE
    `);
    await prisma.ciudad.create({ data: { nombre: CIUDAD_SIN_COBERTURA } });
    // Cada ciudad con su propia cuadrilla: las pruebas de administración mueven y liberan
    // citas, y no deben dejar huecos en la agenda que usan las pruebas de agendamiento.
    for (const [ciudad, cuadrilla] of [
      [CIUDAD_E2E, CUADRILLA_E2E],
      [CIUDAD_ADMIN_E2E, CUADRILLA_ADMIN_E2E],
    ]) {
      const { id: ciudadId } = await prisma.ciudad.create({ data: { nombre: ciudad } });
      await prisma.contratista.create({
        data: {
          nombre: `Contratista de ${ciudad}`,
          ciudades: { create: { ciudadId } },
          cuadrillas: {
            create: {
              nombre: cuadrilla,
              capacidadDiaria: 48,
              instaladores: { create: [{ nombre: `Instalador de ${cuadrilla}` }] },
              disponibilidades: {
                create: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, minutoInicio: 0, minutoFin: 1440 })),
              },
            },
          },
        },
      });
    }
    await prisma.tipoServicio.create({ data: { nombre: SERVICIO_E2E, duracionMin: 60 } });
  } finally {
    await prisma.$disconnect();
  }
}
