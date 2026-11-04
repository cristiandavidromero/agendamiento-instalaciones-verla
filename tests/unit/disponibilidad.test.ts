import { describe, expect, it } from "vitest";
import {
  calcularCandidatas,
  type CitaExistente,
  type CuadrillaDisponible,
} from "@/dominio/disponibilidad";

// Instante a partir de una hora local de Bogotá (UTC−5, sin horario de verano).
const bogota = (fechaHora: string) => new Date(`${fechaHora.replace(" ", "T")}:00-05:00`);
const local = (instante: Date) =>
  new Date(instante.getTime() - 5 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
const h = (horas: number, minutos = 0) => horas * 60 + minutos;

const TODOS_LOS_DIAS = [0, 1, 2, 3, 4, 5, 6];
const bloques = (desde: number, hasta: number, dias = TODOS_LOS_DIAS) =>
  dias.map((diaSemana) => ({ diaSemana, minutoInicio: desde, minutoFin: hasta }));

function cuadrilla(id: number, extra: Partial<CuadrillaDisponible> = {}): CuadrillaDisponible {
  return { id, capacidadDiaria: 10, bloques: bloques(h(8), h(17)), ...extra };
}

const cita = (cuadrillaId: number, inicio: string, fin: string): CitaExistente => ({
  cuadrillaId,
  inicio: bogota(inicio),
  fin: bogota(fin),
});

// Miércoles 4 de noviembre de 2026, 7:00 en Bogotá.
const AHORA = bogota("2026-11-04 07:00");

function candidatas(opciones: {
  cuadrillas?: CuadrillaDisponible[];
  citas?: CitaExistente[];
  duracionMin?: number;
  ahora?: Date;
  horizonteDias?: number;
}) {
  return calcularCandidatas({
    ahora: opciones.ahora ?? AHORA,
    duracionMin: opciones.duracionMin ?? 60,
    cuadrillas: opciones.cuadrillas ?? [cuadrilla(1)],
    citas: opciones.citas ?? [],
    horizonteDias: opciones.horizonteDias,
  });
}

const iniciosDelDia = (lista: ReturnType<typeof candidatas>, dia: string) =>
  lista.map((c) => local(c.inicio)).filter((x) => x.startsWith(dia)).map((x) => x.slice(11));

describe("calcularCandidatas", () => {
  it("sin cuadrillas en la ciudad no hay candidatas", () => {
    expect(candidatas({ cuadrillas: [] })).toEqual([]);
  });

  it("elige la franja más próxima con la duración completa", () => {
    const [primera] = candidatas({ duracionMin: 90 });

    expect(primera.cuadrillaId).toBe(1);
    expect(local(primera.inicio)).toBe("2026-11-04 08:00");
    expect(local(primera.fin)).toBe("2026-11-04 09:30");
  });

  it("genera franjas de 30 minutos dentro de la disponibilidad", () => {
    const inicios = iniciosDelDia(candidatas({}), "2026-11-04");

    expect(inicios.slice(0, 4)).toEqual(["08:00", "08:30", "09:00", "09:30"]);
    expect(inicios).toHaveLength(17); // 8:00 … 16:00 para 60 min en un bloque 8–17
  });

  it("descarta las franjas que ya pasaron hoy", () => {
    const [primera] = candidatas({ ahora: bogota("2026-11-04 10:10") });

    expect(local(primera.inicio)).toBe("2026-11-04 10:30");
  });

  it("descarta las franjas que se cruzan con otra cita", () => {
    const inicios = iniciosDelDia(
      candidatas({ citas: [cita(1, "2026-11-04 09:00", "2026-11-04 10:00")] }),
      "2026-11-04",
    );

    expect(inicios.slice(0, 3)).toEqual(["08:00", "10:00", "10:30"]);
    expect(inicios).not.toContain("08:30"); // 8:30–9:30 pisa la cita
    expect(inicios).not.toContain("09:30");
  });

  it("descarta las franjas donde no cabe la duración completa", () => {
    const inicios = iniciosDelDia(
      candidatas({ duracionMin: 90, cuadrillas: [cuadrilla(1, { bloques: bloques(h(8), h(12)) })] }),
      "2026-11-04",
    );

    expect(inicios.at(-1)).toBe("10:30"); // 10:30–12:00 es la última que cabe
  });

  it("no extiende una instalación entre dos bloques separados", () => {
    const conAlmuerzo = [...bloques(h(8), h(12)), ...bloques(h(13), h(17))];
    const inicios = iniciosDelDia(
      candidatas({ duracionMin: 120, cuadrillas: [cuadrilla(1, { bloques: conAlmuerzo })] }),
      "2026-11-04",
    );

    expect(inicios).toEqual(["08:00", "08:30", "09:00", "09:30", "10:00", "13:00", "13:30", "14:00", "14:30", "15:00"]);
  });

  it("une bloques contiguos o solapados del mismo día", () => {
    const partidos = [...bloques(h(8), h(12)), ...bloques(h(12), h(17))];
    const inicios = iniciosDelDia(
      candidatas({ duracionMin: 120, cuadrillas: [cuadrilla(1, { bloques: partidos })] }),
      "2026-11-04",
    );

    expect(inicios).toContain("11:00"); // 11:00–13:00 cruza las 12:00
    expect(new Set(inicios).size).toBe(inicios.length);
  });

  it("salta al día siguiente cuando la cuadrilla alcanzó su capacidad diaria", () => {
    const [primera] = candidatas({
      cuadrillas: [cuadrilla(1, { capacidadDiaria: 1 })],
      citas: [cita(1, "2026-11-04 15:00", "2026-11-04 16:00")],
    });

    expect(local(primera.inicio)).toBe("2026-11-05 08:00");
  });

  it("cuenta la capacidad por día local, no por día UTC", () => {
    // 21:00 en Bogotá del día 4 es el día 5 en UTC.
    const lista = candidatas({
      cuadrillas: [cuadrilla(1, { capacidadDiaria: 1 })],
      citas: [cita(1, "2026-11-04 21:00", "2026-11-04 22:00")],
    });

    expect(iniciosDelDia(lista, "2026-11-04")).toEqual([]);
    expect(iniciosDelDia(lista, "2026-11-05")[0]).toBe("08:00");
  });

  it("respeta los días de la semana sin disponibilidad", () => {
    const soloLunes = cuadrilla(1, { bloques: bloques(h(8), h(17), [1]) });
    const [primera] = candidatas({ cuadrillas: [soloLunes] });

    expect(local(primera.inicio)).toBe("2026-11-09 08:00");
  });

  it("busca hasta un horizonte de 14 días contando hoy", () => {
    const dias = new Set(candidatas({}).map((c) => local(c.inicio).slice(0, 10)));

    expect(dias.size).toBe(14);
    expect(dias).toContain("2026-11-17");
    expect(dias).not.toContain("2026-11-18");
  });

  it("permite acotar el horizonte", () => {
    const dias = new Set(candidatas({ horizonteDias: 1 }).map((c) => local(c.inicio).slice(0, 10)));

    expect([...dias]).toEqual(["2026-11-04"]);
  });

  it("si dos cuadrillas empatan en la franja gana la de menos carga ese día", () => {
    // La 2 tiene más carga en el horizonte, pero la carga del día manda.
    const [primera, segunda] = candidatas({
      cuadrillas: [cuadrilla(1), cuadrilla(2)],
      citas: [
        cita(1, "2026-11-04 15:00", "2026-11-04 16:00"),
        cita(2, "2026-11-06 08:00", "2026-11-06 09:00"),
        cita(2, "2026-11-07 08:00", "2026-11-07 09:00"),
      ],
    });

    expect([primera.cuadrillaId, local(primera.inicio)]).toEqual([2, "2026-11-04 08:00"]);
    expect([segunda.cuadrillaId, local(segunda.inicio)]).toEqual([1, "2026-11-04 08:00"]);
  });

  it("con igual carga del día desempata por menor carga en el horizonte y luego por id", () => {
    const porCargaTotal = candidatas({
      cuadrillas: [cuadrilla(1), cuadrilla(2)],
      citas: [cita(1, "2026-11-06 08:00", "2026-11-06 09:00")],
    });
    const porId = candidatas({ cuadrillas: [cuadrilla(3), cuadrilla(2)] });

    expect(porCargaTotal[0].cuadrillaId).toBe(2);
    expect(porId[0].cuadrillaId).toBe(2);
  });

  it("la franja más próxima pesa más que la carga", () => {
    const [primera] = candidatas({
      cuadrillas: [cuadrilla(1), cuadrilla(2, { bloques: bloques(h(9), h(17)) })],
      citas: [cita(1, "2026-11-04 15:00", "2026-11-04 16:00")],
    });

    expect([primera.cuadrillaId, local(primera.inicio)]).toEqual([1, "2026-11-04 08:00"]);
  });

  it("rechaza una duración no positiva", () => {
    expect(() => candidatas({ duracionMin: 0 })).toThrow();
  });
});
