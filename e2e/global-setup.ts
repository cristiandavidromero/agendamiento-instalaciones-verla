// Prepara la BD de pruebas para los E2E con un escenario determinista:
// una cuadrilla disponible las 24 h (la franja depende solo del reloj real) y una ciudad sin cobertura.

import { execSync } from "node:child_process";
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

export const CIUDAD_E2E = "Ciudad E2E";
export const CIUDAD_SIN_COBERTURA = "Sin cobertura";
export const CUADRILLA_E2E = "Cuadrilla E2E";
export const SERVICIO_E2E = "Instalación E2E";

export default async function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("Falta DATABASE_URL_TEST (ver .env.example)");
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await prisma.$executeRawUnsafe(`
      TRUNCATE cita, venta, tipo_servicio, disponibilidad_cuadrilla, instalador,
               cuadrilla, contratista_ciudad, contratista, ciudad
      RESTART IDENTITY CASCADE
    `);
    const ciudad = await prisma.ciudad.create({ data: { nombre: CIUDAD_E2E } });
    await prisma.ciudad.create({ data: { nombre: CIUDAD_SIN_COBERTURA } });
    await prisma.contratista.create({
      data: {
        nombre: "Contratista E2E",
        ciudades: { create: { ciudadId: ciudad.id } },
        cuadrillas: {
          create: {
            nombre: CUADRILLA_E2E,
            capacidadDiaria: 48,
            instaladores: { create: [{ nombre: "Instalador E2E" }] },
            disponibilidades: {
              create: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, minutoInicio: 0, minutoFin: 1440 })),
            },
          },
        },
      },
    });
    await prisma.tipoServicio.create({ data: { nombre: SERVICIO_E2E, duracionMin: 60 } });
  } finally {
    await prisma.$disconnect();
  }
}
