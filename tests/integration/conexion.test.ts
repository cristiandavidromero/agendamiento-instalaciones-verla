import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

describe("conexión a la BD de pruebas", () => {
  afterAll(() => prisma.$disconnect());

  it("responde a una consulta sobre agenda_test", async () => {
    const [fila] = await prisma.$queryRaw<{ bd: string }[]>`SELECT current_database() AS bd`;
    expect(fila.bd).toBe("agenda_test");
  });
});
