import { describe, expect, it } from "vitest";
import { ReglaDeNegocioError, validarInstaladores } from "@/dominio/cuadrilla";

describe("validarInstaladores", () => {
  it("rechaza una cuadrilla sin instaladores", () => {
    expect(() => validarInstaladores([])).toThrow(ReglaDeNegocioError);
  });

  it.each([[["Ana"]], [["Ana", "Luis"]]])("acepta %j", (nombres) => {
    expect(() => validarInstaladores(nombres)).not.toThrow();
  });

  it("rechaza más de 2 instaladores", () => {
    expect(() => validarInstaladores(["Ana", "Luis", "Marta"])).toThrow(ReglaDeNegocioError);
  });
});
