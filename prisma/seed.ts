import { validarInstaladores } from "../src/dominio/cuadrilla";
import { prisma } from "../src/lib/prisma";
import { agendarVenta } from "../src/servicios/agendar";
import { liberarCita, opcionesDeReprogramacion, reprogramarCita } from "../src/servicios/administrar";

// Datos simulados: ventas cerradas desde ahora (pasan por el agendamiento real) y algunos
// cambios de operaciones para que la agenda y el historial tengan contenido en la demo.
const VENTAS_SIMULADAS = 40;
const OPERADORA = "Laura Méndez (operaciones)";

// Generador pseudoaleatorio con semilla fija: el seed produce siempre la misma mezcla de ventas.
function aleatorio(semilla: number) {
  return () => {
    semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

  await simularOperacion([...ciudades.values()]);
}

async function simularOperacion(ciudadIds: number[]) {
  const azar = aleatorio(2026);
  const tipos = await prisma.tipoServicio.findMany({ orderBy: { id: "asc" } });

  // 60 % de las ventas en la primera ciudad (Bogotá), el resto en la segunda.
  const citas = [];
  for (let i = 0; i < VENTAS_SIMULADAS; i++) {
    const venta = await prisma.venta.create({
      data: {
        ciudadId: azar() < 0.6 ? ciudadIds[0] : ciudadIds[1],
        tipoServicioId: tipos[Math.floor(azar() * tipos.length)].id,
      },
    });
    const resultado = await agendarVenta(venta.id);
    if (resultado.estado === "AGENDADA") citas.push(resultado.cita);
  }

  // Cambios de operaciones sobre algunas citas: dos movidas, una reasignada y dos liberadas.
  const cambios = [
    { cita: citas[3], tipo: "mover", motivo: "El cliente pidió más tarde" },
    { cita: citas[11], tipo: "mover", motivo: "Acceso al edificio solo en la tarde" },
    { cita: citas[7], tipo: "reasignar", motivo: "Balancear carga entre cuadrillas" },
    { cita: citas[15], tipo: "liberar", motivo: "Cliente canceló la instalación" },
    { cita: citas[22], tipo: "liberar", motivo: "Cliente reprogramará por teléfono" },
  ] as const;
  let aplicados = 0;
  for (const { cita, tipo, motivo } of cambios) {
    if (!cita) continue;
    if (tipo === "liberar") {
      await liberarCita(cita.id, { actor: OPERADORA, motivo });
    } else {
      const { franjas } = await opcionesDeReprogramacion(cita.id);
      const destino =
        tipo === "mover"
          ? franjas.filter((f) => f.cuadrillaId === cita.cuadrillaId)[4]
          : franjas.find((f) => f.cuadrillaId !== cita.cuadrillaId);
      if (!destino) continue;
      await reprogramarCita(cita.id, { cuadrillaId: destino.cuadrillaId, inicio: destino.inicio, actor: OPERADORA, motivo });
    }
    aplicados++;
  }

  const pendientes = await prisma.venta.count({ where: { estado: "CERRADA" } });
  console.log(
    `Simulación: ${VENTAS_SIMULADAS} ventas, ${await prisma.cita.count()} citas agendadas, ` +
      `${pendientes} pendientes de agenda, ${aplicados} cambios de operaciones en el historial`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
