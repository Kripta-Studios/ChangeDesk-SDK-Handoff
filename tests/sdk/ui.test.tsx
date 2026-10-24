// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import InternalPanel, { ExecutionProgress, PlanPreview } from "../../packages/sdk-react/src/panel/InternalPanel.js";
import { ChangeDeskProvider } from "../../packages/sdk-react/src/provider.js";
import type { ChangeDeskClient } from "../../packages/sdk-react/src/client.js";

const client = (overrides: Partial<ChangeDeskClient> = {}) => ({
  createRequest: vi.fn(), getRequest: vi.fn(), selectCandidate: vi.fn(), createPlan: vi.fn(), getPlan: vi.fn(), approvePlan: vi.fn(), startExecution: vi.fn(), getExecution: vi.fn(), cancelExecution: vi.fn(), resumeExecution: vi.fn(), getInstallations: vi.fn().mockResolvedValue({ installations: [], permissions: ["read", "request", "preview"] }), getResources: vi.fn(), installAction: vi.fn(), publishAction: vi.fn(), revokePublication: vi.fn(), getEvidence: vi.fn(), clearSession: vi.fn(), ...overrides,
}) as ChangeDeskClient;

const renderInternal = (api: ChangeDeskClient) => render(
  <ChangeDeskProvider config={{ endpoint: "https://desk.example.test", getSession: vi.fn(), locale: "es", getContext: () => ({ selectedProductIds: ["prod_1"], surface: "product.list" }) }} client={api}>
    <InternalPanel />
  </ChangeDeskProvider>,
);

describe("ChangeDeskPanel", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("labels the fake provider and never treats stored HTML as markup", async () => {
    const api = client({
      createRequest: vi.fn().mockResolvedValue({ requestId: "req_1", status: "received" }),
      getRequest: vi.fn().mockResolvedValue({ requestId: "req_1", status: "candidate_offered", safeMessage: "<img src=x onerror=alert(1)>", providerMode: "fake", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", candidates: [{ id: "cand_1", artifactHash: "b".repeat(64), recipeKey: "catalog.campaign.prepare.v1", version: "1", displayName: "<script>alert(1)</script>", compatibility: "compatible", evidenceStatus: "passed", requiredCapabilities: [], missingParameters: [], estimatedCost: null }], permissions: ["request", "preview"] }),
    });
    renderInternal(api);
    await userEvent.type(await screen.findByLabelText("¿Qué necesitas cambiar?"), "Prepara campaña");
    await userEvent.click(screen.getByRole("button", { name: "Buscar una función" }));

    expect(await screen.findByText("Proveedor simulado")).toBeTruthy();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("does not show approval controls unless the server grants approve and execute", async () => {
    const plan = { id: "plan_1", schemaVersion: "1", tenantId: "hidden", actorId: "hidden", requestId: "req_1", artifactHash: "b".repeat(64), adapterVersion: "1", policyVersion: "1", capabilityManifestHash: "c".repeat(64), parameters: {}, selectionSnapshot: [], state: "ready", planHash: "a".repeat(64), planVersion: 1, createdAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-01T00:10:00Z", perRecordEffects: [], exclusions: [], evidenceRefs: [], limits: { maxRecords: 100, maxSteps: 12 } } as const;
    render(<PlanPreview view={{ plan, title: "Plan de campaña", canApprove: false, permissions: ["read", "preview"] }} canApprove={false} busy={false} onApprove={vi.fn()}/>);
    expect(screen.queryByRole("button", { name: "Aprobar y ejecutar" })).toBeNull();
    expect(screen.getByText(/puede revisar este plan/)).toBeTruthy();
  });

  it("shows unknown partial work explicitly and offers controlled reconciliation", async () => {
    const onResume = vi.fn();
    render(<ExecutionProgress execution={{ id: "exec_1", tenantId: "hidden", planId: "plan_1", planVersion: 1, approvalId: "approval_1", actorId: "hidden", state: "waiting_reconciliation", revision: 4, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:01:00Z", permissions: ["read", "execute"], rows: [{ rowId: "row_1", resourceRef: "Producto A", state: "unknown", steps: [{ stepId: "addChannel", capability: "medusa.sales_channels.products.add", state: "unknown" }] }] }} onResume={onResume}/>);
    expect(screen.getByText("Efecto desconocido")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Reconciliar y reanudar" }));
    expect(onResume).toHaveBeenCalledOnce();
    expect(screen.queryByText(/deshacer/i)).toBeNull();
  });

  it("clears the in-memory session when the panel unmounts", async () => {
    const api = client();
    const view = renderInternal(api);
    screen.getByLabelText("¿Qué necesitas cambiar?");
    view.unmount();
    expect(api.clearSession).toHaveBeenCalledOnce();
  });
});
