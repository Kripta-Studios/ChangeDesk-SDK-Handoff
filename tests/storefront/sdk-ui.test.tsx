// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StorefrontAdminReview, StorefrontPreferencesPanel, StorefrontRoot } from "../../packages/sdk-react/src/storefront/components.js";
import { StorefrontProvider } from "../../packages/sdk-react/src/storefront/provider.js";
import type { StorefrontAdminClient, StorefrontClient } from "../../packages/sdk-react/src/storefront/client.js";

const preferences = { overrides: {}, effective: { theme: "system" as const, density: "comfortable" as const, productLayout: "grid" as const }, buyerRevision: 0, globalRevision: 0 };
const buyerClient: StorefrontClient = { getPreferences: vi.fn(async () => preferences), replacePreferences: vi.fn(async (input) => ({ ...preferences, overrides: input.overrides, buyerRevision: 1 })), createGlobalProposal: vi.fn(async (input) => ({ id: "p1", ...input, status: "pending", proposalRevision: 1, createdAt: "2026-10-24T12:00:00.000Z" })), getOwnProposal: vi.fn(), clearSession: vi.fn() };

describe("storefront buyer UI", () => {
  it("supports keyboard navigation, inherited fields, explicit save/reset/propose, and a consuming opt-in root", async () => {
    const user = userEvent.setup();
    render(<StorefrontProvider client={buyerClient}><StorefrontPreferencesPanel /><StorefrontRoot><article data-testid="product-card">Product</article></StorefrontRoot></StorefrontProvider>);
    const theme = await screen.findByLabelText("Tema"); expect(within(theme).getByRole("option", { name: "Heredar configuración de tienda" })).toBeTruthy();
    await user.selectOptions(theme, "dark");
    expect(screen.getByTestId("product-card").closest(".changedesk-storefront-root")?.getAttribute("data-theme")).toBe("dark");
    await user.tab(); expect(document.activeElement).not.toBe(document.body);
    await user.click(screen.getByRole("button", { name: "Solo para mí" })); expect(buyerClient.replacePreferences).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Restablecer mis preferencias" })); expect(buyerClient.replacePreferences).toHaveBeenCalledWith(expect.objectContaining({ overrides: {} }), expect.anything());
    await user.click(screen.getByRole("button", { name: "Proponer para toda la tienda" })); expect(await screen.findByText(/pendiente de revisión/i)).toBeTruthy();
  });
});

describe("storefront administrator review UI", () => {
  it("shows preview and precedence notice, then exposes stale 409 without claiming apply", async () => {
    const adminClient: StorefrontAdminClient = { listProposals: vi.fn(async () => ({ proposals: [{ proposalId: "p1", proposalRevision: 1, current: preferences.effective, proposed: { theme: "dark", density: "compact", productLayout: "list" }, globalRevision: 0, precedenceNotice: "Los overrides personales se conservan.", status: "pending" }] })), getProposal: vi.fn(), approveProposal: vi.fn(async () => { throw Object.assign(new Error("stale"), { status: 409 }); }), rejectProposal: vi.fn(), clearSession: vi.fn() };
    render(<StorefrontAdminReview client={adminClient} />);
    expect(await screen.findByText(/overrides personales se conservan/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aprobar cambio global" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/ha cambiado.*revisar/i);
    expect(screen.queryByText(/aplicado correctamente/i)).toBeNull();
  });
});
