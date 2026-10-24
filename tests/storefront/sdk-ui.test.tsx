// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorefrontAdminPanel, StorefrontPreferencesPanel, StorefrontRoot } from "../../packages/sdk-react/src/storefront/components.js";
import { StorefrontProvider } from "../../packages/sdk-react/src/storefront/provider.js";
import type { StorefrontAdminClient, StorefrontClient } from "../../packages/sdk-react/src/storefront/client.js";

const preferences = { overrides: {}, effective: { theme: "system" as const, density: "comfortable" as const, productLayout: "grid" as const }, buyerRevision: 0, globalRevision: 0 };
const buyerClient: StorefrontClient = { getPreferences: vi.fn(async () => preferences), replacePreferences: vi.fn(async (input) => ({ ...preferences, overrides: input.overrides, buyerRevision: 1 })), createGlobalProposal: vi.fn(async (input) => ({ id: "p1", ...input, status: "pending", proposalRevision: 1, createdAt: "2026-10-24T12:00:00.000Z" })), getOwnProposal: vi.fn(), clearSession: vi.fn() };
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
    const client: StorefrontClient = { ...buyerClient, getPreferences: vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(switched), clearSession: vi.fn() };
    const view = render(<StorefrontProvider client={client} sessionKey="buyer-a"><StorefrontPreferencesPanel /><StorefrontRoot><span data-testid="session-product">Product</span></StorefrontRoot></StorefrontProvider>);
    await vi.waitFor(() => expect(finishOld).toBeTypeOf("function"));
    view.rerender(<StorefrontProvider client={client} sessionKey="buyer-b"><StorefrontPreferencesPanel /><StorefrontRoot><span data-testid="session-product">Product</span></StorefrontRoot></StorefrontProvider>);
    finishOld({ ...preferences, overrides: { theme: "dark" }, effective: { ...preferences.effective, theme: "dark" } });
    await waitFor(() => expect(screen.getByTestId("session-product").closest(".changedesk-storefront-root")?.getAttribute("data-theme")).toBe("light"));
    expect(client.clearSession).toHaveBeenCalled();
  });
});

describe("storefront administrator review UI", () => {
  it("shows preview and precedence notice, then exposes stale 409 without claiming apply", async () => {
    const adminClient: StorefrontAdminClient = { listProposals: vi.fn(async () => ({ proposals: [{ proposalId: "p1", proposalRevision: 1, current: preferences.effective, proposed: { theme: "dark", density: "compact", productLayout: "list" }, globalRevision: 0, precedenceNotice: "Los overrides personales se conservan.", status: "pending" }] })), getProposal: vi.fn(), approveProposal: vi.fn(async () => { throw Object.assign(new Error("stale"), { status: 409 }); }), rejectProposal: vi.fn(), clearSession: vi.fn() };
    render(<StorefrontAdminPanel client={adminClient} />);
    expect(await screen.findByText(/overrides personales se conservan/i)).toBeTruthy();
    expect(screen.getByText(/system/i)).toBeTruthy();
    expect(screen.getByText(/dark/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aprobar cambio global" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/ha cambiado.*revisar/i);
    expect(screen.queryByText(/aplicado correctamente/i)).toBeNull();
  });

  it("requires an explicit reject action and reports it without claiming a global apply", async () => {
    const preview = { proposalId: "p1", proposalRevision: 1, current: preferences.effective, proposed: { theme: "dark" as const, density: "compact" as const, productLayout: "list" as const }, globalRevision: 0, precedenceNotice: "Los overrides personales se conservan.", status: "pending" as const };
    const adminClient: StorefrontAdminClient = { listProposals: vi.fn(async () => ({ proposals: [preview] })), getProposal: vi.fn(), approveProposal: vi.fn(), rejectProposal: vi.fn(async () => ({ ...preview, proposalRevision: 2, status: "rejected" })), clearSession: vi.fn() };
    const user = userEvent.setup();
    render(<StorefrontAdminPanel client={adminClient} />);
    await user.click(await screen.findByRole("button", { name: "Rechazar propuesta" }));
    expect(adminClient.rejectProposal).toHaveBeenCalledWith("p1", 1, expect.anything());
    expect(await screen.findByText(/propuesta rechazada/i)).toBeTruthy();
    expect(screen.queryByText(/aplicado correctamente/i)).toBeNull();
  });
});
