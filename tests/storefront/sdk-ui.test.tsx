// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorefrontAdminPanel, StorefrontPreferencesPanel, StorefrontRoot } from "../../packages/sdk-react/src/storefront/components.js";
import { StorefrontProvider } from "../../packages/sdk-react/src/storefront/provider.js";
import { createStorefrontAdminClient, createStorefrontClient, type StorefrontAdminClient, type StorefrontClient } from "../../packages/sdk-react/src/storefront/client.js";

const preferences = { overrides: {}, inherited: { theme: "system" as const, density: "comfortable" as const, productLayout: "grid" as const }, effective: { theme: "system" as const, density: "comfortable" as const, productLayout: "grid" as const }, buyerRevision: 0, globalRevision: 0 };
function withInvalidation(client: Omit<StorefrontClient, "subscribeSessionInvalidation">): StorefrontClient {
  const listeners = new Set<() => void>();
  const clearSession = vi.fn(() => { client.clearSession(); for (const listener of listeners) listener(); });
  return { ...client, clearSession, subscribeSessionInvalidation(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
const buyerClient: StorefrontClient = withInvalidation({ getPreferences: vi.fn(async () => preferences), replacePreferences: vi.fn(async (input) => ({ ...preferences, overrides: input.overrides, buyerRevision: 1 })), createGlobalProposal: vi.fn(async (input) => ({ id: "p1", ...input, status: "pending", proposalRevision: 1, createdAt: "2026-10-24T12:00:00.000Z" })), getOwnProposal: vi.fn(), clearSession: vi.fn() });
function withAdminInvalidation(client: Omit<StorefrontAdminClient, "subscribeSessionInvalidation">): StorefrontAdminClient {
  const listeners = new Set<() => void>();
  return { ...client, clearSession() { client.clearSession(); for (const listener of listeners) listener(); }, subscribeSessionInvalidation(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
afterEach(() => cleanup());

describe("storefront buyer UI", () => {
  it("supports keyboard navigation, inherited fields, explicit save/reset/propose, and a consuming opt-in root", async () => {
    const user = userEvent.setup();
    render(<StorefrontProvider client={buyerClient}><StorefrontPreferencesPanel /><StorefrontRoot><div className="changedesk-storefront-products"><article data-testid="product-card">Product</article><article>Second</article></div></StorefrontRoot></StorefrontProvider>);
    const theme = await screen.findByLabelText("Tema"); expect(within(theme).getByRole("option", { name: "Heredar configuración de tienda" })).toBeTruthy();
    await user.selectOptions(theme, "dark");
    expect(screen.getByTestId("product-card").closest(".changedesk-storefront-root")?.getAttribute("data-theme")).toBe("dark");
    await user.selectOptions(screen.getByLabelText("Densidad"), "compact");
    await user.selectOptions(screen.getByLabelText("Distribución de productos"), "list");
    const root = screen.getByTestId("product-card").closest(".changedesk-storefront-root") as HTMLElement;
    expect(root.getAttribute("data-density")).toBe("compact");
    expect(root.getAttribute("data-product-layout")).toBe("list");
    expect(getComputedStyle(root).getPropertyValue("--changedesk-storefront-card-gap")).toBe("0.625rem");
    await user.tab(); expect(document.activeElement).not.toBe(document.body);
    await user.click(screen.getByRole("button", { name: "Solo para mí" })); expect(buyerClient.replacePreferences).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Restablecer mis preferencias" })); expect(buyerClient.replacePreferences).toHaveBeenCalledWith(expect.objectContaining({ overrides: {} }), expect.anything());
    await user.click(screen.getByRole("button", { name: "Proponer para toda la tienda" })); expect(await screen.findByText(/pendiente de revisión/i)).toBeTruthy();
  });

  it("clears provider state on an explicit host session identity change and ignores the old response", async () => {
    let finishOld!: (value: typeof preferences) => void;
    const switched = { ...preferences, overrides: { theme: "light" as const }, effective: { ...preferences.effective, theme: "light" as const } };
    const client: StorefrontClient = withInvalidation({ ...buyerClient, getPreferences: vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(switched), clearSession: vi.fn() });
    const view = render(<StorefrontProvider client={client} sessionKey="buyer-a"><StorefrontPreferencesPanel /><StorefrontRoot><span data-testid="session-product">Product</span></StorefrontRoot></StorefrontProvider>);
    await vi.waitFor(() => expect(finishOld).toBeTypeOf("function"));
    view.rerender(<StorefrontProvider client={client} sessionKey="buyer-b"><StorefrontPreferencesPanel /><StorefrontRoot><span data-testid="session-product">Product</span></StorefrontRoot></StorefrontProvider>);
    finishOld({ ...preferences, overrides: { theme: "dark" }, effective: { ...preferences.effective, theme: "dark" } });
    await waitFor(() => expect(screen.getByTestId("session-product").closest(".changedesk-storefront-root")?.getAttribute("data-theme")).toBe("light"));
    expect(client.clearSession).toHaveBeenCalled();
  });

  it("clears visible preferences when the same client is logged out directly", async () => {
    const client = withInvalidation({ ...buyerClient, clearSession: vi.fn(), getPreferences: vi.fn(async () => ({ ...preferences, overrides: { theme: "dark" as const }, effective: { ...preferences.effective, theme: "dark" as const } })) });
    render(<StorefrontProvider client={client}><StorefrontPreferencesPanel /><StorefrontRoot><span data-testid="logout-product">Product</span></StorefrontRoot></StorefrontProvider>);
    expect(await screen.findByDisplayValue("Oscuro")).toBeTruthy();
    client.clearSession();
    await waitFor(() => expect((screen.getByLabelText("Tema") as HTMLSelectElement).disabled).toBe(true));
    expect(screen.getByTestId("logout-product").closest(".changedesk-storefront-root")?.getAttribute("data-theme")).toBe("system");
  });

  it("does not apply a pending response after direct clearSession on the same client", async () => {
    let finish!: (value: typeof preferences) => void;
    const client = withInvalidation({ ...buyerClient, clearSession: vi.fn(), getPreferences: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
    render(<StorefrontProvider client={client}><StorefrontPreferencesPanel /><StorefrontRoot><span data-testid="late-product">Product</span></StorefrontRoot></StorefrontProvider>);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    client.clearSession();
    finish({ ...preferences, overrides: { theme: "dark" }, effective: { ...preferences.effective, theme: "dark" } });
    await waitFor(() => expect((screen.getByLabelText("Tema") as HTMLSelectElement).disabled).toBe(true));
    expect(screen.getByTestId("late-product").closest(".changedesk-storefront-root")?.getAttribute("data-theme")).toBe("system");
  });

  it("previews the inherited global value when an existing personal override is removed", async () => {
    const overridden = { ...preferences, inherited: { ...preferences.inherited, theme: "light" as const }, overrides: { theme: "dark" as const }, effective: { ...preferences.effective, theme: "dark" as const } };
    const client = withInvalidation({ ...buyerClient, clearSession: vi.fn(), getPreferences: vi.fn(async () => overridden) });
    const user = userEvent.setup();
    render(<StorefrontProvider client={client}><StorefrontPreferencesPanel /><StorefrontRoot><span data-testid="inherit-product">Product</span></StorefrontRoot></StorefrontProvider>);
    await user.selectOptions(await screen.findByLabelText("Tema"), "");
    expect(screen.getByTestId("inherit-product").closest(".changedesk-storefront-root")?.getAttribute("data-theme")).toBe("light");
  });

  it("removes buyer preferences and draft immediately when a save receives 401", async () => {
    const loaded = { ...preferences, overrides: { theme: "dark" as const }, effective: { ...preferences.effective, theme: "dark" as const } };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT"
      ? new Response(JSON.stringify({ error: { code: "session_expired", message: "Sesión expirada", requestId: "buyer-401", retryable: false } }), { status: 401, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify(loaded), { headers: { "content-type": "application/json" } }));
    const client = createStorefrontClient({ endpoint: "https://desk.example.test", getSession: async () => ({ accessToken: "buyer", expiresAt: "2099-01-01T00:00:00Z" }), fetch: fetcher });
    const user = userEvent.setup();
    render(<StorefrontProvider client={client}><StorefrontPreferencesPanel /><StorefrontRoot><span data-testid="buyer-401-product">Product</span></StorefrontRoot></StorefrontProvider>);
    expect(await screen.findByDisplayValue("Oscuro")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Solo para mí" }));
    await waitFor(() => expect((screen.getByLabelText("Tema") as HTMLSelectElement).disabled).toBe(true));
    expect(screen.getByTestId("buyer-401-product").closest(".changedesk-storefront-root")?.getAttribute("data-theme")).toBe("system");
    expect(screen.getByRole("alert").textContent).toMatch(/sesión expirada/i);
  });
});

describe("storefront administrator review UI", () => {
  it("shows preview and precedence notice, then exposes stale 409 without claiming apply", async () => {
    const adminClient = withAdminInvalidation({ listProposals: vi.fn(async () => ({ proposals: [{ proposalId: "p1", proposalRevision: 1, current: preferences.effective, proposed: { theme: "dark", density: "compact", productLayout: "list" }, globalRevision: 0, precedenceNotice: "Los overrides personales se conservan.", status: "pending" }] })), getProposal: vi.fn(), approveProposal: vi.fn(async () => { throw Object.assign(new Error("stale"), { status: 409 }); }), rejectProposal: vi.fn(), clearSession: vi.fn() });
    render(<StorefrontAdminPanel client={adminClient} />);
    expect(await screen.findByText(/overrides personales se conservan/i)).toBeTruthy();
    expect(screen.getByText("Sistema")).toBeTruthy();
    expect(screen.getByText("Oscuro")).toBeTruthy();
    expect(screen.getByText("Pendiente")).toBeTruthy();
    expect(screen.getByText(/Versión global 0/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aprobar cambio global" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/ha cambiado.*revisar/i);
    expect(screen.queryByText(/aplicado correctamente/i)).toBeNull();
  });

  it("requires an explicit reject action and reports it without claiming a global apply", async () => {
    const preview = { proposalId: "p1", proposalRevision: 1, current: preferences.effective, proposed: { theme: "dark" as const, density: "compact" as const, productLayout: "list" as const }, globalRevision: 0, precedenceNotice: "Los overrides personales se conservan.", status: "pending" as const };
    const adminClient = withAdminInvalidation({ listProposals: vi.fn(async () => ({ proposals: [preview] })), getProposal: vi.fn(), approveProposal: vi.fn(), rejectProposal: vi.fn(async () => ({ ...preview, proposalRevision: 2, status: "rejected" })), clearSession: vi.fn() });
    const user = userEvent.setup();
    render(<StorefrontAdminPanel client={adminClient} />);
    await user.click(await screen.findByRole("button", { name: "Rechazar propuesta" }));
    expect(adminClient.rejectProposal).toHaveBeenCalledWith("p1", 1, expect.anything());
    expect(await screen.findByText(/propuesta rechazada/i)).toBeTruthy();
    expect(screen.queryByText(/aplicado correctamente/i)).toBeNull();
  });

  it("removes resolved tenant proposals immediately when the same admin client is cleared", async () => {
    const preview = { proposalId: "atlas-proposal", proposalRevision: 1, current: preferences.effective, proposed: { theme: "dark" as const, density: "compact" as const, productLayout: "list" as const }, globalRevision: 0, precedenceNotice: "Los overrides personales se conservan.", status: "pending" as const };
    const client = withAdminInvalidation({ listProposals: vi.fn(async () => ({ proposals: [preview] })), getProposal: vi.fn(), approveProposal: vi.fn(), rejectProposal: vi.fn(), clearSession: vi.fn() });
    render(<StorefrontAdminPanel client={client} />);
    expect(await screen.findByText("Propuesta atlas-proposal")).toBeTruthy();
    client.clearSession();
    await waitFor(() => expect(screen.queryByText("Propuesta atlas-proposal")).toBeNull());
    expect(screen.getByText(/sesión.*invalidada/i)).toBeTruthy();
  });

  it("does not repopulate proposals from a late list response after same-client clearSession", async () => {
    let finish!: (value: { proposals: readonly [{ proposalId: string; proposalRevision: number; current: typeof preferences.effective; proposed: typeof preferences.effective; globalRevision: number; precedenceNotice: string; status: "pending" }] }) => void;
    const client = withAdminInvalidation({ listProposals: vi.fn(() => new Promise((resolve) => { finish = resolve; })), getProposal: vi.fn(), approveProposal: vi.fn(), rejectProposal: vi.fn(), clearSession: vi.fn() });
    render(<StorefrontAdminPanel client={client} />);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    client.clearSession();
    finish({ proposals: [{ proposalId: "atlas-late", proposalRevision: 1, current: preferences.effective, proposed: preferences.effective, globalRevision: 0, precedenceNotice: "No debe aparecer", status: "pending" }] });
    await waitFor(() => expect(screen.getByText(/sesión.*invalidada/i)).toBeTruthy());
    expect(screen.queryByText("Propuesta atlas-late")).toBeNull();
  });

  it("removes resolved admin proposals immediately when approve receives 401", async () => {
    const preview = { proposalId: "atlas-401", proposalRevision: 1, current: preferences.effective, proposed: { theme: "dark" as const, density: "compact" as const, productLayout: "list" as const }, globalRevision: 0, precedenceNotice: "Los overrides personales se conservan.", status: "pending" as const };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname.endsWith("/approve")
      ? new Response(JSON.stringify({ error: { code: "session_expired", message: "Sesión administrativa expirada", requestId: "admin-401", retryable: false } }), { status: 401, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ proposals: [preview] }), { headers: { "content-type": "application/json" } }));
    const client = createStorefrontAdminClient({ endpoint: "https://desk.example.test", getSession: async () => ({ accessToken: "admin", expiresAt: "2099-01-01T00:00:00Z" }), fetch: fetcher });
    const user = userEvent.setup();
    render(<StorefrontAdminPanel client={client} />);
    expect(await screen.findByText("Propuesta atlas-401")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Aprobar cambio global" }));
    await waitFor(() => expect(screen.queryByText("Propuesta atlas-401")).toBeNull());
    expect(screen.getByText(/sesión administrativa invalidada/i)).toBeTruthy();
  });
});
