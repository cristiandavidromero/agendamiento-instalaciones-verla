import { PrismaClient } from "@prisma/client";
import { validarInstaladores } from "../src/dominio/cuadrilla";

const prisma = new PrismaClient();

const h = (horas: number, minutos = 0) => horas * 60 + minutos;

// Lunes a viernes 8:00–12:00 y 13:00–17:00 (dos bloques con almuerzo).
const JORNADA_SEMANA = [1, 2, 3, 4, 5].flatMap((diaSemana) => [
  { diaSemana, minutoInicio: h(8), minutoFin: h(12) },
  { diaSemana, minutoInicio: h(13), minutoFin: h(17) },
]);
const SABADO_MANANA = [{ diaSemana: 6, minutoInicio: h(8), minutoFin: h(12) }];

const CONTRATISTAS = [
  {
    nombre: "Instalaciones Andinas",
    ciudades: ["Bogotá"],
    cuadrillas: [
      { nombre: "Andinas Norte", capacidadDiaria: 4, instaladores: ["Camilo Rojas", "Diana Pérez"], bloques: [...JORNADA_SEMANA, ...SABADO_MANANA] },
      { nombre: "Andinas Sur", capacidadDiaria: 3, instaladores: ["Julián Mora"], bloques: JORNADA_SEMANA },
    ],
  },
  {
    nombre: "Redes del Valle",
    ciudades: ["Bogotá", "Medellín"],
    cuadrillas: [
      { nombre: "Valle 1", capacidadDiaria: 5, instaladores: ["Laura Gómez", "Andrés Ruiz"], bloques: JORNADA_SEMANA },
    ],
  },
  {
    nombre: "Conecta Antioquia",
    ciudades: ["Medellín"],
    cuadrillas: [
      { nombre: "Conecta Centro", capacidadDiaria: 4, instaladores: ["Sara Henao", "Mateo Zapata"], bloques: [...JORNADA_SEMANA, ...SABADO_MANANA] },
      { nombre: "Conecta Envigado", capacidadDiaria: 2, instaladores: ["Felipe Ríos"], bloques: JORNADA_SEMANA },
    ],
  },
];

const TIPOS_SERVICIO = [
  { nombre: "Instalación básica", duracionMin: 60 },
  { nombre: "Instalación estándar", duracionMin: 90 },
  { nombre: "Instalación con cableado", duracionMin: 120 },
];

async function main() {
  // El seed es idempotente: reinicia las tablas de dominio.
  await prisma.$executeRawUnsafe(`
    TRUNCATE historial_cita, cita, venta, tipo_servicio, disponibilidad_cuadrilla, instalador,
             cuadrilla, contratista_ciudad, contratista, ciudad
    RESTART IDENTITY CASCADE
  `);

  const nombresCiudad = [...new Set(CONTRATISTAS.flatMap((c) => c.ciudades))];
  const ciudades = new Map<string, number>();
  for (const nombre of nombresCiudad) {
    ciudades.set(nombre, (await prisma.ciudad.create({ data: { nombre } })).id);
  }

  for (const contratista of CONTRATISTAS) {
    await prisma.contratista.create({
      data: {
        nombre: contratista.nombre,
        ciudades: { create: contratista.ciudades.map((c) => ({ ciudadId: ciudades.get(c)! })) },
        cuadrillas: {
          create: contratista.cuadrillas.map((cuadrilla) => {
            validarInstaladores(cuadrilla.instaladores);
            return {
              nombre: cuadrilla.nombre,
              capacidadDiaria: cuadrilla.capacidadDiaria,
              instaladores: { create: cuadrilla.instaladores.map((nombre) => ({ nombre })) },
              disponibilidades: { create: cuadrilla.bloques },
            };
          }),
        },
      },
    });
  }

  await prisma.tipoServicio.createMany({ data: TIPOS_SERVICIO });

  console.log(
    `Seed: ${ciudades.size} ciudades, ${CONTRATISTAS.length} contratistas, ` +
      `${CONTRATISTAS.flatMap((c) => c.cuadrillas).length} cuadrillas, ${TIPOS_SERVICIO.length} tipos de servicio`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
