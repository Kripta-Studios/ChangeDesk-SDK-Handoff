import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Tenant = "atlas" | "boreal";
type Credentials = Record<string, { email: string; password: string }>;
const storefront = "http://127.0.0.1:8000";
const service = "http://127.0.0.1:4100";
const hosts: Record<Tenant, string> = { atlas: "http://127.0.0.1:9001", boreal: "http://127.0.0.1:9002" };
const privateDir = resolve("examples/medusa/.local");
function fixture<T>(file: string): T { const target = resolve(privateDir, file); if (!existsSync(target)) throw new Error(`E2E_BLOCKED_PRIVATE_FIXTURE: ${file}`); return JSON.parse(readFileSync(target, "utf8")) as T; }
const buyers = (tenant: Tenant) => fixture<Credentials>(`buyer-credentials.${tenant}.json`);
const staff = (tenant: Tenant) => fixture<Credentials>(`credentials.${tenant}.json`);

async function loginBuyer(page: Page, tenant: Tenant, key: string) {
  const credential = buyers(tenant)[`${tenant}.${key}`]; if (!credential) throw new Error(`E2E_BLOCKED_BUYER: ${tenant}.${key}`);
  await page.goto(storefront); await page.getByLabel("Tienda").selectOption(tenant); await page.getByLabel("Email customer").fill(credential.email); await page.getByLabel("Contraseña").fill(credential.password); await page.getByRole("button", { name: "Entrar al escaparate" }).click();
  await expect(page.getByRole("heading", { name: "Ajusta cómo compras" })).toBeVisible();
}
async function loginAdmin(page: Page, tenant: Tenant) {
  const credential = staff(tenant)[`${tenant}.admin`]; if (!credential) throw new Error(`E2E_BLOCKED_ACTOR: ${tenant}.admin`);
  const login = await page.request.post(`${hosts[tenant]}/auth/user/emailpass`, { data: credential }); expect(login.ok()).toBeTruthy();
  const { token } = await login.json() as { token: string }; expect((await page.request.post(`${hosts[tenant]}/auth/session`, { headers: { Authorization: `Bearer ${token}` } })).ok()).toBeTruthy();
}
async function freshContext(context: BrowserContext) { await context.clearCookies(); }

test.describe.serial("buyer storefront real Atlas/Boreal", () => {
  test("dos buyers y dos tenants: persistencia, propuesta inerte y aprobación conservan overrides", async ({ page, browser }) => {
    test.setTimeout(180_000); let buyerToken = "";
    page.on("request", (request) => { if (new URL(request.url()).pathname === "/v1/storefront/me/preferences") buyerToken = request.headers().authorization?.replace(/^Bearer /, "") ?? buyerToken; });
    await loginBuyer(page, "atlas", "buyer1");
    await page.getByLabel("Tema").selectOption("dark"); await page.getByRole("button", { name: "Solo para mí" }).click(); await expect(page.getByText("Preferencias guardadas solo para ti.")).toBeVisible();
    await page.reload(); await expect(page.getByLabel("Tema")).toHaveValue("dark");
    await page.getByLabel("Densidad").selectOption("compact");
    const proposalResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/v1/storefront/global-change-proposals" && response.status() === 201);
    await page.getByRole("button", { name: "Proponer para toda la tienda" }).click(); const proposal = await (await proposalResponse).json() as { id: string };
    await expect(page.getByText(/queda pendiente.+todavía no se ha aplicado/)).toBeVisible(); await page.reload();
    await expect(page.locator(".changedesk-storefront-root")).toHaveAttribute("data-density", "comfortable");

    const adminContext = await browser.newContext(); const admin = await adminContext.newPage(); await loginAdmin(admin, "atlas"); await admin.goto(`${hosts.atlas}/app/changedesk-storefront`);
    const card = admin.getByRole("article").filter({ hasText: proposal.id }); await expect(card).toBeVisible(); await card.getByRole("button", { name: "Aprobar cambio global" }).click(); await expect(card).toContainText("Aprobada"); await adminContext.close();
    await page.reload(); await expect(page.getByLabel("Tema")).toHaveValue("dark"); await expect(page.locator(".changedesk-storefront-root")).toHaveAttribute("data-density", "compact");

    await page.getByRole("button", { name: "Cerrar sesión" }).click(); await expect(page.getByRole("button", { name: "Entrar al escaparate" })).toBeVisible();
    expect((await page.request.get(`${service}/v1/storefront/me/preferences`, { headers: { Authorization: `Bearer ${buyerToken}` } })).status()).toBe(401);
    await loginBuyer(page, "atlas", "buyer2"); await expect(page.getByLabel("Tema")).toHaveValue(""); await expect(page.locator(".changedesk-storefront-root")).toHaveAttribute("data-theme", "dark");

    await page.getByRole("button", { name: "Cerrar sesión" }).click(); await freshContext(page.context()); await loginBuyer(page, "boreal", "buyer1");
    await expect(page.locator(".changedesk-storefront-root")).toHaveAttribute("data-density", "comfortable"); await expect(page.locator(".changedesk-storefront-root")).toHaveAttribute("data-theme", "system");
  });
});
