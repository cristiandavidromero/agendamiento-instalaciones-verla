import { expect, test, type Page } from "@playwright/test";
import { CIUDAD_E2E, CIUDAD_SIN_COBERTURA, CUADRILLA_E2E, SERVICIO_E2E } from "./global-setup";

async function cerrarVenta(page: Page, ciudad: string) {
  await page.getByLabel("Ciudad").selectOption({ label: ciudad });
  await page.getByLabel("Tipo de servicio").selectOption({ label: `${SERVICIO_E2E} (60 min)` });
  const antes = await page.locator(".resultados > li").count();
  await page.getByRole("button", { name: "Cerrar venta y agendar" }).click();
  await expect(page.locator(".resultados > li")).toHaveCount(antes + 1);
  // El resultado más reciente aparece primero.
  return page.locator(".resultados > li").first();
}

const instante = async (resultado: ReturnType<Page["locator"]>, clase: "inicio" | "fin") =>
  new Date((await resultado.locator(`time.${clase}`).getAttribute("datetime"))!);

test("cerrar una venta muestra la cuadrilla y la hora; la siguiente obtiene la franja contigua", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Cerrar venta" })).toBeVisible();

  const primera = await cerrarVenta(page, CIUDAD_E2E);
  await expect(primera).toContainText("agendada");
  await expect(primera.locator(".cuadrilla")).toHaveText(CUADRILLA_E2E);
  await expect(primera.locator("time.inicio")).toHaveText(/^\d{2}:\d{2}$/);
  const inicio = await instante(primera, "inicio");
  const fin = await instante(primera, "fin");
  expect(fin.getTime() - inicio.getTime()).toBe(60 * 60_000);
  expect(inicio.getTime()).toBeGreaterThanOrEqual(Date.now() - 60_000);
  expect([0, 30]).toContain(inicio.getUTCMinutes());

  const segunda = await cerrarVenta(page, CIUDAD_E2E);
  await expect(segunda.locator(".cuadrilla")).toHaveText(CUADRILLA_E2E);
  expect((await instante(segunda, "inicio")).getTime()).toBe(fin.getTime());
});

test("una ciudad sin cobertura muestra que no hay cupo", async ({ page }) => {
  await page.goto("/");

  const resultado = await cerrarVenta(page, CIUDAD_SIN_COBERTURA);

  await expect(resultado).toHaveClass(/sin-cupo/);
  await expect(resultado).toContainText("sin cupo en los próximos 14 días");
});

test("la agenda de la cuadrilla muestra la cita recién asignada", async ({ page }) => {
  await page.goto("/");
  const resultado = await cerrarVenta(page, CIUDAD_E2E);
  const ventaId = (await resultado.locator("strong").textContent())!.match(/#(\d+)/)![1];
  const inicio = await resultado.locator("time.inicio").getAttribute("datetime");

  await page.getByRole("link", { name: "Agenda", exact: true }).click();

  const tarjeta = page.getByRole("region", { name: CUADRILLA_E2E });
  const fila = tarjeta.locator("li", { hasText: `Venta #${ventaId}` });
  await expect(fila).toContainText(SERVICIO_E2E);
  await expect(fila.locator("time")).toHaveAttribute("datetime", inicio!);
});
