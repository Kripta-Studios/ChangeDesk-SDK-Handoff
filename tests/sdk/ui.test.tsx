// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import InternalPanel, { ExecutionProgress, PlanPreview } from "../../packages/sdk-react/src/panel/InternalPanel.js";
import { ChangeDeskProvider } from "../../packages/sdk-react/src/provider.js";
import type { ChangeDeskClient } from "../../packages/sdk-react/src/client.js";

const client = (overrides: Partial<ChangeDeskClient> = {}) => ({
  createRequest: vi.fn(), getRequest: vi.fn(), sendMessage: vi.fn(), selectCandidate: vi.fn(), createPlan: vi.fn(), getPlan: vi.fn(), approvePlan: vi.fn(), startExecution: vi.fn(), getExecution: vi.fn(), cancelExecution: vi.fn(), resumeExecution: vi.fn(), getInstallations: vi.fn().mockResolvedValue({ installations: [], permissions: ["read", "request", "preview"], identity: { tenantName: "tenant_1", actorName: "actor_1", role: "requester", scopeId: "scope_1" } }), getResources: vi.fn(), installAction: vi.fn(), publishAction: vi.fn(), revokePublication: vi.fn(), getEvidence: vi.fn(), clearSession: vi.fn(), ...overrides,
}) as ChangeDeskClient;

const renderInternal = (api: ChangeDeskClient) => render(
  <ChangeDeskProvider config={{ endpoint: "https://desk.example.test", getSession: vi.fn(), locale: "es", getContext: () => ({ selectedProductIds: ["prod_1"], surface: "product.list" }) }} client={api}>
    <InternalPanel />
  </ChangeDeskProvider>,
);

describe("ChangeDeskPanel", () => {
  afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); });

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
    const installedConfig = (ids: string[]) => ({ endpoint: "https://desk.example.test", getSession: vi.fn(), locale: "es" as const, getContext: () => ({ selectedProductIds: ids, surface: "installed.action" }) });
    const view = render(<ChangeDeskProvider config={installedConfig(["prod_1"])} client={api}><InternalPanel initialInstallationId="ins_1" /></ChangeDeskProvider>);
    await userEvent.selectOptions(await screen.findByLabelText("Categoría"), "cat_1");
    await userEvent.click(screen.getByRole("button", { name: "Preparar preview" }));
    expect(api.createRequest).not.toHaveBeenCalled();
    expect(api.createPlan).toHaveBeenCalledWith(expect.objectContaining({ installationId: "ins_1", selectedProductIds: ["prod_1"], parameters: { categoryId: "cat_1" } }));
    expect(await screen.findByRole("button", { name: "Aprobar y ejecutar" })).toBeTruthy();
    view.rerender(<ChangeDeskProvider config={installedConfig(["prod_2"])} client={api}><InternalPanel initialInstallationId="ins_1" /></ChangeDeskProvider>);
    expect(await screen.findByText(/preview anterior se invalidó/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aprobar y ejecutar" })).toBeNull();
  });

  it("installs a prepared action without abandoning its approvable preview", async () => {
    const artifactHash = "b".repeat(64);
    const plan = { id: "plan_install", schemaVersion: "1", tenantId: "hidden", actorId: "hidden", requestId: "req_install", artifactHash, adapterVersion: "1", policyVersion: "1", capabilityManifestHash: "c".repeat(64), parameters: {}, selectionSnapshot: ["prod_1"], state: "ready", planHash: "a".repeat(64), planVersion: 1, createdAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-01T00:10:00Z", perRecordEffects: [], exclusions: [], evidenceRefs: [], limits: { maxRecords: 100, maxSteps: 12 } } as const;
    const identity = { tenantName: "tenant_1", actorName: "actor_1", role: "operator", scopeId: "scope_1" };
    const installation = { id: "ins_new", artifactHash, recipeKey: "catalog.campaign.prepare.v1", displayName: "Preparar campaña", version: "1", state: "active", policyVersion: "1", evidenceStatus: "passed", permissions: ["read", "execute"], installedAt: "2026-01-01T00:00:00Z" } as const;
    const api = client({
      getInstallations: vi.fn().mockResolvedValueOnce({ installations: [], permissions: ["read", "request", "preview", "approve", "execute", "install"], identity }).mockResolvedValue({ installations: [installation], permissions: ["read", "request", "preview", "approve", "execute", "install"], identity }),
      createRequest: vi.fn().mockResolvedValue({ requestId: "req_install", status: "received" }),
      getRequest: vi.fn().mockResolvedValue({ requestId: "req_install", status: "candidate_offered", safeMessage: "Lista", providerMode: "fake", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", candidates: [{ id: "cand_install", artifactHash, recipeKey: "catalog.campaign.prepare.v1", version: "1", displayName: "Preparar campaña", compatibility: "compatible", evidenceStatus: "passed", requiredCapabilities: [], missingParameters: [], estimatedCost: null }], permissions: ["request", "preview", "approve", "execute", "install"] }),
      selectCandidate: vi.fn().mockResolvedValue({ requestId: "req_install", status: "needs_configuration" }),
      getResources: vi.fn().mockResolvedValue({ resources: [] }),
      createPlan: vi.fn().mockResolvedValue({ planId: plan.id, status: "ready" }),
      getPlan: vi.fn().mockResolvedValue({ plan, title: "Preparar campaña", canApprove: true, permissions: ["approve", "execute", "install"] }),
      installAction: vi.fn().mockResolvedValue({ installationId: installation.id }),
    });
    renderInternal(api);
    await userEvent.type(screen.getByLabelText("¿Qué necesitas cambiar?"), "Prepara campaña");
    await userEvent.click(screen.getByRole("button", { name: "Buscar una función" }));
    await userEvent.click(await screen.findByRole("button", { name: "Usar esta función" }));
    await userEvent.click(await screen.findByRole("button", { name: "Preparar preview" }));
    await userEvent.click(await screen.findByRole("button", { name: "Instalar acción" }));
    expect(await screen.findByRole("heading", { name: "Preview del plan" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Instalar acción" })).toBeNull();
    expect(screen.getByRole("button", { name: "Aprobar y ejecutar" })).toBeTruthy();
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
    const first = render(<ChangeDeskProvider config={config} client={api}><InternalPanel /></ChangeDeskProvider>);
    await userEvent.type(screen.getByLabelText("¿Qué necesitas cambiar?"), "Prepara campaña");
    await userEvent.click(screen.getByRole("button", { name: "Buscar una función" }));
    await screen.findByText("Lista");
    first.unmount();
    render(<ChangeDeskProvider config={config} client={api}><InternalPanel /></ChangeDeskProvider>);
    await screen.findByText("Lista");
    expect(api.getRequest).toHaveBeenCalledTimes(2);
    expect(api.createRequest).toHaveBeenCalledOnce();
  });

  it("drops durable identifiers before a different actor scope can fetch them", async () => {
    sessionStorage.setItem("changedesk:resume:https://desk.example.test:active", "scope_old");
    sessionStorage.setItem("changedesk:resume:https://desk.example.test:scope_old", JSON.stringify({ planId: "plan_private" }));
    const api = client({
      getInstallations: vi.fn().mockResolvedValue({ installations: [], permissions: ["read"], identity: { tenantName: "tenant_1", actorName: "actor_2", role: "admin", scopeId: "scope_new" } }),
      getPlan: vi.fn(),
    });
    renderInternal(api);
    await screen.findByText(/actor_2/);
    expect(api.getPlan).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("changedesk:resume:https://desk.example.test:scope_old")).toBeNull();
    expect(sessionStorage.getItem("changedesk:resume:https://desk.example.test:active")).toBe("scope_new");
  });

  it("uses the English message catalog when locale is en", () => {
    const api = client();
    render(<ChangeDeskProvider config={{ endpoint: "https://desk.example.test", getSession: vi.fn(), locale: "en", getContext: () => ({ selectedProductIds: ["prod_1"], surface: "product.list" }) }} client={api}><InternalPanel /></ChangeDeskProvider>);
    expect(screen.getByRole("heading", { name: "Describe the outcome" })).toBeTruthy();
    expect(screen.getByLabelText("What do you need to change?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find a function" })).toBeTruthy();
  });
});
