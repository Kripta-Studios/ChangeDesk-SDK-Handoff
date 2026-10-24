// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import InternalPanel, { ExecutionProgress, PlanPreview } from "../../packages/sdk-react/src/panel/InternalPanel.js";
import { ChangeDeskProvider } from "../../packages/sdk-react/src/provider.js";
import type { ChangeDeskClient } from "../../packages/sdk-react/src/client.js";

const client = (overrides: Partial<ChangeDeskClient> = {}) => ({
  createRequest: vi.fn(), getRequest: vi.fn(), sendMessage: vi.fn(), selectCandidate: vi.fn(), createPlan: vi.fn(), getPlan: vi.fn(), approvePlan: vi.fn(), startExecution: vi.fn(), getExecution: vi.fn(), cancelExecution: vi.fn(), resumeExecution: vi.fn(), getInstallations: vi.fn().mockResolvedValue({ installations: [], permissions: ["read", "request", "preview"] }), getResources: vi.fn(), installAction: vi.fn(), publishAction: vi.fn(), revokePublication: vi.fn(), getEvidence: vi.fn(), clearSession: vi.fn(), ...overrides,
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

  it("runs an installed action through configuration and planning without creating a model request", async () => {
    const api = client({
      getInstallations: vi.fn().mockResolvedValue({ permissions: ["read", "preview", "approve", "execute"], installations: [{ id: "ins_1", artifactHash: "b".repeat(64), recipeKey: "catalog.category.assign.v1", displayName: "Asignar categoría", version: "1", state: "active", policyVersion: "1", evidenceStatus: "passed", permissions: ["read", "execute"], installedAt: "2026-01-01T00:00:00Z" }] }),
      getResources: vi.fn().mockResolvedValue({ resources: [{ id: "cat_1", label: "Otoño", kind: "category" }] }),
      createPlan: vi.fn().mockResolvedValue({ planId: "plan_1", status: "ready" }),
      getPlan: vi.fn().mockResolvedValue({ title: "Asignar categoría", canApprove: true, permissions: ["approve", "execute"], plan: { id: "plan_1", schemaVersion: "1", tenantId: "hidden", actorId: "hidden", requestId: "installed", artifactHash: "b".repeat(64), adapterVersion: "1", policyVersion: "1", capabilityManifestHash: "c".repeat(64), parameters: {}, selectionSnapshot: [], state: "ready", planHash: "a".repeat(64), planVersion: 1, createdAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-01T00:10:00Z", perRecordEffects: [], exclusions: [], evidenceRefs: [], limits: { maxRecords: 100, maxSteps: 12 } } }),
    });
    render(<ChangeDeskProvider config={{ endpoint: "https://desk.example.test", getSession: vi.fn(), locale: "es", getContext: () => ({ selectedProductIds: ["prod_1"], surface: "installed.action" }) }} client={api}><InternalPanel initialInstallationId="ins_1" /></ChangeDeskProvider>);
    await userEvent.selectOptions(await screen.findByLabelText("Categoría"), "cat_1");
    await userEvent.click(screen.getByRole("button", { name: "Preparar preview" }));
    expect(api.createRequest).not.toHaveBeenCalled();
    expect(api.createPlan).toHaveBeenCalledWith(expect.objectContaining({ installationId: "ins_1", selectedProductIds: ["prod_1"], parameters: { categoryId: "cat_1" } }));
  });

  it("sends clarification as a conversation message instead of creating another request", async () => {
    const api = client({
      createRequest: vi.fn().mockResolvedValue({ requestId: "req_1", status: "received" }),
      getRequest: vi.fn().mockResolvedValue({ requestId: "req_1", status: "needs_clarification", safeMessage: "¿Qué categoría quieres usar?", providerMode: "fake", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", candidates: [], permissions: ["request"] }),
      sendMessage: vi.fn().mockResolvedValue({ requestId: "req_1", status: "received" }),
    });
    renderInternal(api);
    await userEvent.type(screen.getByLabelText("¿Qué necesitas cambiar?"), "Prepara campaña");
    await userEvent.click(screen.getByRole("button", { name: "Buscar una función" }));
    await userEvent.clear(await screen.findByLabelText("Aclara la petición"));
    await userEvent.type(screen.getByLabelText("Aclara la petición"), "La categoría Otoño");
    await userEvent.click(screen.getByRole("button", { name: "Enviar aclaración" }));
    expect(api.createRequest).toHaveBeenCalledOnce();
    expect(api.sendMessage).toHaveBeenCalledWith("req_1", expect.objectContaining({ message: "La categoría Otoño" }));
  });

  it("reopens an authorized request by opaque ID without persisting a token", async () => {
    const api = client({
      createRequest: vi.fn().mockResolvedValue({ requestId: "req_resume", status: "received" }),
      getRequest: vi.fn().mockResolvedValue({ requestId: "req_resume", status: "candidate_offered", safeMessage: "Lista", providerMode: "fake", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", candidates: [], permissions: ["request"] }),
    });
    const config = { endpoint: "https://desk.example.test", getSession: vi.fn(), locale: "es" as const, getContext: () => ({ selectedProductIds: ["prod_1"], surface: "product.list" }) };
    const Harness = () => { const [open, setOpen] = React.useState(true); return <ChangeDeskProvider config={config} client={api}><button onClick={() => setOpen(false)}>Cerrar prueba</button><button onClick={() => setOpen(true)}>Reabrir prueba</button>{open ? <InternalPanel /> : null}</ChangeDeskProvider>; };
    render(<Harness/>);
    await userEvent.type(screen.getByLabelText("¿Qué necesitas cambiar?"), "Prepara campaña");
    await userEvent.click(screen.getByRole("button", { name: "Buscar una función" }));
    await screen.findByText("Lista");
    await userEvent.click(screen.getByRole("button", { name: "Cerrar prueba" }));
    await userEvent.click(screen.getByRole("button", { name: "Reabrir prueba" }));
    await screen.findByText("Lista");
    expect(api.getRequest).toHaveBeenCalledTimes(2);
    expect(api.createRequest).toHaveBeenCalledOnce();
  });

  it("uses the English message catalog when locale is en", () => {
    const api = client();
    render(<ChangeDeskProvider config={{ endpoint: "https://desk.example.test", getSession: vi.fn(), locale: "en", getContext: () => ({ selectedProductIds: ["prod_1"], surface: "product.list" }) }} client={api}><InternalPanel /></ChangeDeskProvider>);
    expect(screen.getByRole("heading", { name: "Describe the outcome" })).toBeTruthy();
    expect(screen.getByLabelText("What do you need to change?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find a function" })).toBeTruthy();
  });
});
