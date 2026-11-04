import { expect, test, type Page } from "@playwright/test";
import { CIUDAD_ADMIN_E2E, SERVICIO_E2E } from "./global-setup";

const RESPONSABLE = "Operador E2E";

// Cierra una venta desde la pantalla de ventas y devuelve su número.
async function ventaAgendada(page: Page) {
  await page.goto("/");
  await page.getByLabel("Ciudad").selectOption({ label: CIUDAD_ADMIN_E2E });
  await page.getByLabel("Tipo de servicio").selectOption({ label: `${SERVICIO_E2E} (60 min)` });
  await page.getByRole("button", { name: "Cerrar venta y agendar" }).click();
  const resultado = page.locator(".resultados > li").first();
  await expect(resultado).toContainText("agendada");
  return (await resultado.locator("strong").textContent())!.match(/#(\d+)/)![1];
}

async function abrirBandeja(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Responsable del cambio").fill(RESPONSABLE);
}

const filaDeCita = (page: Page, ventaId: string) =>
  page.getByRole("region", { name: "Próximas citas" }).locator(`li[data-venta="${ventaId}"]`);

test("mover una cita a otra franja la actualiza y queda en el historial", async ({ page }) => {
  const ventaId = await ventaAgendada(page);
  await abrirBandeja(page);
  const fila = filaDeCita(page, ventaId);
  const antes = await fila.locator("time").getAttribute("datetime");

  await fila.getByRole("button", { name: "Mover o reasignar" }).click();
  const franja = fila.getByLabel("Nueva franja");
  await expect(franja.locator("option").nth(1)).toBeAttached();
  const destino = await franja.locator("option").nth(1).getAttribute("value");
  await franja.selectOption(destino!);
  await fila.getByLabel("Motivo (opcional)").fill("Prueba E2E");
  await fila.getByRole("button", { name: "Guardar cambio" }).click();

  await expect(page.getByRole("status")).toContainText(`Venta #${ventaId} movida`);
  await expect(filaDeCita(page, ventaId).locator("time")).toHaveAttribute("datetime", new Date(destino!).toISOString());
  expect(destino).not.toBe(antes);
  const historial = page.getByRole("region", { name: "Historial de cambios" });
  await expect(historial.locator("li").first()).toContainText(`${RESPONSABLE} movió la venta #${ventaId}`);
  await expect(historial.locator("li").first()).toContainText("Prueba E2E");
});

test("liberar una cita la deja pendiente y se puede volver a agendar", async ({ page }) => {
  const ventaId = await ventaAgendada(page);
  await abrirBandeja(page);
  const fila = filaDeCita(page, ventaId);

  await fila.getByRole("button", { name: "Liberar" }).click();
  await fila.getByRole("button", { name: "Confirmar liberación" }).click();

  await expect(page.getByRole("status")).toContainText(`venta #${ventaId} liberada`);
  await expect(filaDeCita(page, ventaId)).toHaveCount(0);
  const pendiente = page.getByRole("region", { name: "Ventas pendientes de agenda" }).locator(`li[data-venta="${ventaId}"]`);
  await expect(pendiente).toBeVisible();

  await pendiente.getByRole("button", { name: "Agendar en la franja más próxima" }).click();

  await expect(page.getByRole("status")).toContainText(`Venta #${ventaId} agendada`);
  await expect(filaDeCita(page, ventaId)).toBeVisible();
  await expect(page.getByRole("region", { name: "Historial de cambios" })).toContainText(
    `${RESPONSABLE} liberó la venta #${ventaId}`,
  );
});
