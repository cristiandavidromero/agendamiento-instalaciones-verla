import { describe, expect, it } from "vitest";
import { claveDia, diaSemana, fechaLocal, instanteLocal, sumarDias } from "@/dominio/tiempo";

describe("tiempo local de negocio", () => {
  it("convierte las 8:00 de Bogotá a las 13:00 UTC", () => {
    expect(instanteLocal({ anio: 2026, mes: 11, dia: 4 }, 8 * 60).toISOString()).toBe(
      "2026-11-04T13:00:00.000Z",
    );
  });

  it("obtiene la fecha local aunque en UTC ya sea el día siguiente", () => {
    expect(claveDia(fechaLocal(new Date("2026-11-05T02:00:00Z")))).toBe("2026-11-04");
  });

  it("suma días cruzando fin de mes y de año", () => {
    expect(claveDia(sumarDias({ anio: 2026, mes: 12, dia: 25 }, 14))).toBe("2027-01-08");
  });

  it("calcula el día de la semana (0 = domingo)", () => {
    expect(diaSemana({ anio: 2026, mes: 11, dia: 4 })).toBe(3); // miércoles
    expect(diaSemana({ anio: 2026, mes: 11, dia: 8 })).toBe(0); // domingo
  });

  it("respeta el horario de verano en zonas que lo tienen", () => {
    const zona = "Europe/Madrid";
    expect(instanteLocal({ anio: 2026, mes: 1, dia: 15 }, 9 * 60, zona).toISOString()).toBe(
      "2026-01-15T08:00:00.000Z",
    );
    expect(instanteLocal({ anio: 2026, mes: 7, dia: 15 }, 9 * 60, zona).toISOString()).toBe(
      "2026-07-15T07:00:00.000Z",
    );
  });
});
