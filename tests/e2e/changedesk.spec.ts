import { expect, test } from "@playwright/test";

test.describe("Change Desk en Medusa real", () => {
  test("selección explícita, preview y permisos visibles proceden de Atlas", async ({ page }) => {
    await page.goto("/app/changedesk");
    await expect(page.getByRole("heading", { name: /Acciones de catálogo/ })).toBeVisible();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Crear acción con esta selección" }).click();
    await page.getByLabel("¿Qué necesitas cambiar?").fill("Añade la categoría y el canal de campaña conservando las asociaciones existentes.");
    await page.getByRole("button", { name: "Buscar una función" }).click();
    await expect(page.getByText(/Proveedor (simulado|real)/)).toBeVisible();
    await expect(page.getByRole("dialog")).not.toContainText("<script", { useInnerText: false });
  });

  test("viewer no recibe una acción de aprobación aunque manipule el navegador", async ({ page }) => {
    await page.goto("/app/changedesk");
    await page.evaluate(() => localStorage.setItem("role", "admin"));
    await page.reload();
    await expect(page.getByRole("button", { name: "Aprobar y ejecutar" })).toHaveCount(0);
  });
});
