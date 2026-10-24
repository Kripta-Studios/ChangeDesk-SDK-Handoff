import { randomUUID } from "node:crypto";
import type { JsonValue, Recipe } from "@changedesk/contracts";
import { Store } from "../storage/index.js";
import type { ActorContext, HostConnector, ProductSnapshot } from "../runtime/types.js";
import { compilePlan } from "../runtime/compiler.js";
import { ApiError, forbidden, notFound } from "./errors.js";
import type { ApiOperations, MutationContext } from "./ports.js";
import type { CatalogPort } from "../planner/index.js";
import { hashCanonical } from "../core/hashing.js";

export class StorageApiOperations implements ApiOperations {
  constructor(private readonly store: Store, private readonly connector: HostConnector, private readonly resourceIds: Readonly<Record<string, { category: readonly string[]; channel: readonly string[] }>>, private readonly catalog?: CatalogPort, private readonly publicationKeyId?: string, private readonly clock = () => new Date(), private readonly proofRequired = false) {}
  authorizeEffectClaim(input: any) { return this.store.withTenant({ tenantId: input.tenantId, actorId: input.actorId }, async (tx) => { const decision = await tx.authorizeEffectClaim(input); return decision.authorized ? { ...decision, fence: input.fence } : decision; }); }
  createRequest(c: MutationContext, b: any) { return this.run(c.actor, async (tx: any) => { const r = await tx.createRequestAndJob({ id: randomUUID(), actorId: c.actor.actorId, redactedText: b.message, contextRef: { selectedProductIds: b.selectedProductIds, locale: b.locale ?? "es", clientRequestId: b.clientRequestId }, budget: {}, jobId: randomUUID(), idempotencyKey: c.idempotencyKey, requestHash: c.requestHash }); return { requestId: r.id, status: r.state }; }); }
  getRequest(a: ActorContext, id: string) { return this.run(a, async (tx: any) => { const r = await tx.getRequest(id); this.owner(a, r?.actorId); if (!r) return null; const candidates = await tx.listRequestCandidates(id); return { requestId: r.id, status: r.state, safeMessage: safeRequestMessage(r.state), providerMode: "unavailable", candidates, permissions: uiPermissions(a), createdAt: r.createdAt.toISOString(), updatedAt: r.createdAt.toISOString() }; }); }
  addMessage(c: MutationContext, id: string, b: any) { return this.run(c.actor, async (tx: any) => { const r = await tx.getRequest(id); this.owner(c.actor, r?.actorId); if (!r) throw notFound(); const m = await tx.addRequestMessage({ id: randomUUID(), requestId: id, clientRequestId: b.clientRequestId, redactedText: b.message }); return { requestId: id, messageId: m.id, status: r.state }; }); }
  getCandidates(a: ActorContext, id: string) { return this.run(a, async (tx: any) => { const r = await tx.getRequest(id); this.owner(a, r?.actorId); return r ? { candidates: await tx.listRequestCandidates(id) } : null; }); }
  selectCandidate(c: MutationContext, id: string, b: any) { return this.run(c.actor, async (tx: any) => { const r = await tx.getRequest(id); this.owner(c.actor, r?.actorId); if (!r) throw notFound(); const selected = await tx.selectRequestCandidate({ requestId: id, candidateId: b.candidateId, version: b.version, choice: b.choice, idempotencyKey: c.idempotencyKey, requestHash: c.requestHash }); if (!selected) throw notFound(); await tx.updateRequestState(id, "needs_configuration"); return { requestId: id, status: "needs_configuration", candidateId: selected.id }; }); }
  async getResources(a: ActorContext, kind: "category" | "channel", q: { limit?: number }) {
    const capability = kind === "category" ? "medusa.product_categories.retrieve" as const : "medusa.sales_channels.retrieve" as const;
    const resources = await Promise.all((this.resourceIds[a.tenantId]?.[kind] ?? []).slice(0, q.limit ?? 50).map(async (id) => {
      const result = await this.connector.readAuthorized({ capability, args: kind === "category" ? { categoryId: id } : { channelId: id }, actor: a });
      return { id, label: resourceLabel(id, result), kind };
    }));
    return { resources };
  }
  async createPlan(c: MutationContext, b: any) {
    const source = await this.run(c.actor, async (tx: any) => {
      const manifest = await tx.getActiveCapabilityManifest();
      if (!manifest) throw new ApiError(503, "ACTIVE_CAPABILITY_MANIFEST_UNAVAILABLE", "Plan compilation requires an active persisted capability manifest", true);
      let prior: any;
      if (b.priorExecutionId) { prior = await tx.getExecutionDetail(b.priorExecutionId); if (!prior) throw notFound(); this.owner(c.actor, prior.execution.actor_id ?? prior.execution.actorId); if (["queued", "running", "waiting_reconciliation"].includes(prior.execution.state) || prior.attempts.some((attempt: any) => ["sent", "unknown"].includes(attempt.state))) throw new ApiError(409, "PRIOR_EXECUTION_NOT_RECONCILED", "The prior execution must be reconciled and terminal", false); }
      if (b.requestId) {
        const request = await tx.getRequest(b.requestId); this.owner(c.actor, request?.actorId); if (!request) throw notFound();
        const candidate = (await tx.listRequestCandidates(b.requestId)).find((item: any) => item.state === "selected");
        if (!candidate?.artifactHash) throw new ApiError(409, "CANDIDATE_NOT_SELECTED", "A generated or catalog candidate must be selected", false);
        const artifact = await tx.getAuthorizedArtifact(candidate.artifactHash); if (!artifact) throw notFound();
        return { requestId: request.id, installationId: undefined, artifact, manifest, prior };
      }
      const installed = await tx.getInstallationForPlan(b.installationId); if (!installed || installed.installation.status !== "active") throw notFound();
      return { requestId: undefined, installationId: installed.installation.id, artifact: installed.artifact, manifest, prior };
    });
    const recipe = source.artifact.canonicalBody as Recipe;
    const manifest = source.manifest.body as Record<string, unknown>;
    const approved = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
    if (manifest.capabilityContract !== "1" || manifest.verifiedMedusaVersion !== "2.22.1" || recipe.compatibility?.adapter !== "medusa-v2" || recipe.compatibility?.capabilityContract !== "1" || recipe.compatibility?.verifiedMedusaVersion !== "2.22.1" || recipe.requiredCapabilities.some((capability) => !approved.includes(capability))) throw new ApiError(409, "PLAN_SOURCE_INCOMPATIBLE", "The selected action is incompatible with the active capability manifest", false);
    if (!sameKeys(Object.keys(recipe.parameters), Object.keys(b.parameters))) throw new ApiError(422, "PLAN_PARAMETERS_INVALID", "Plan parameters do not exactly match the action contract", false);
    if (source.prior) { const priorPlan = (source.prior.plan.body ?? source.prior.plan) as Record<string, any>; const priorIds = new Set([...(priorPlan.selectionSnapshot ?? []).map((row: any) => row.productId), ...(priorPlan.exclusions ?? []).map((row: any) => row.recordId)]); if (priorPlan.artifactHash !== source.artifact.artifactHash || JSON.stringify(priorPlan.parameters) !== JSON.stringify(Object.fromEntries(Object.entries(b.parameters).sort(([a], [z]) => a.localeCompare(z)))) || (b.selectedProductIds as string[]).some((id) => !priorIds.has(id))) throw new ApiError(409, "PRIOR_EXECUTION_SCOPE_MISMATCH", "The resumed plan must preserve artifact, parameters, and selection scope", false); }
    await this.authorizeDestinations(c.actor, b.parameters);
    const readableProducts = await Promise.all((b.selectedProductIds as string[]).map(async (productId) => parseProduct(productId, await this.connector.readAuthorized({ capability: "medusa.products.retrieve", args: { productId }, actor: c.actor }))));
    const planId = randomUUID();
    const requestId = source.requestId ?? randomUUID();
    const compiled = compilePlan({ planId, tenantId: c.actor.tenantId, actorId: c.actor.actorId, requestId, artifactHash: source.artifact.artifactHash,
      adapterVersion: "medusa-2.22.1/changedesk-1", policyVersion: c.actor.policyVersion, capabilityManifestHash: source.manifest.manifestHash,
      recipe, parameters: b.parameters, selectedProductIds: b.selectedProductIds, readableProducts,
      expiresAt: new Date(this.clock().getTime() + 10 * 60_000).toISOString(), planVersion: 1,
      ...(b.priorExecutionId ? { priorExecutionId: b.priorExecutionId } : {}), proofPolicy: { proofRequired: this.proofRequired, evidenceStatus: this.proofRequired ? "blocked" : "not_applicable", evidenceRefs: [] } });
    const { planHash, ...body } = compiled;
    return this.run(c.actor, async (tx: any) => {
      if (!source.requestId) await tx.createInstalledActionRequest({ id: requestId, actorId: c.actor.actorId, redactedText: "Installed action preview", contextRef: { source: "installed_action", installationId: source.installationId, selectedProductIds: b.selectedProductIds }, budget: {}, idempotencyKey: c.idempotencyKey, requestHash: c.requestHash });
      const plan = await tx.createPlan({ id: planId, requestId, ...(source.installationId ? { installationId: source.installationId } : {}), actorId: c.actor.actorId, artifactHash: source.artifact.artifactHash,
        adapterVersion: compiled.adapterVersion, policyVersion: compiled.policyVersion, capabilityManifestHash: compiled.capabilityManifestHash, body, planHash, planVersion: 1, state: "ready", expiresAt: new Date(compiled.expiresAt), idempotencyKey: c.idempotencyKey, requestHash: c.requestHash });
      await tx.updateRequestState(requestId, "plan_ready");
      return { planId: plan.id, status: plan.state };
    });
  }
  getPlan(a: ActorContext, id: string) { return this.run(a, async (tx: any) => {
    const detail = await tx.getPlanDetail(id); this.owner(a, detail?.actorId); if (!detail) return null;
    const body = detail.body as Record<string, unknown>;
    const plan = { ...body, id: detail.id, requestId: detail.requestId, artifactHash: detail.artifactHash, adapterVersion: detail.adapterVersion, policyVersion: detail.policyVersion, capabilityManifestHash: detail.capabilityManifestHash, planVersion: detail.planVersion, planHash: detail.planHash, state: detail.state, expiresAt: detail.expiresAt.toISOString(), createdAt: detail.createdAt.toISOString() };
    const permissions = uiPermissions(a);
    const selections = Array.isArray(body.selectionSnapshot) ? body.selectionSnapshot as any[] : [], effects = Array.isArray(body.perRecordEffects) ? body.perRecordEffects as any[] : [], exclusions = Array.isArray(body.exclusions) ? body.exclusions as any[] : [];
    const rows = selections.map((selection) => { const rowEffects = effects.filter((effect) => effect.recordId === selection.productId); const applied = rowEffects.filter((effect) => effect.expected === "apply"); return { recordId: selection.productId, productLabel: selection.productId, observedStatus: "published", before: [], additions: applied.map((effect) => effect.stepId), outcome: applied.length > 0 ? "apply" : "no_op" }; }).concat(exclusions.map((item) => ({ recordId: item.recordId, productLabel: item.recordId, observedStatus: item.reason === "status" ? "not_published" : "blocked", before: [], additions: [], outcome: item.reason === "policy" ? "blocked" : "excluded", reason: item.reason })));
    return { plan, title: "Change plan", canApprove: detail.state === "ready" && permissions.includes("approve"), permissions, rows, summary: { selected: rows.length, eligible: selections.length, additions: effects.filter((effect) => effect.expected === "apply").length, noOp: effects.filter((effect) => effect.expected === "no_op").length, excluded: exclusions.filter((item) => item.reason === "status").length, blocked: exclusions.filter((item) => item.reason === "policy").length } };
  }); }
  createApproval(c: MutationContext, b: any) { return this.run(c.actor, async (tx: any) => { const p = await tx.getPlan(b.planId); this.owner(c.actor, p?.actorId); if (!p) throw notFound(); const r = await tx.createApproval({ id: randomUUID(), planId: b.planId, planVersion: b.expectedPlanVersion, planHash: b.planHash, actorId: c.actor.actorId, hostSessionId: c.actor.hostSessionId, scope: ["execute"], expiresAt: new Date(Math.min(p.expiresAt.getTime(), this.clock().getTime() + 600_000)), idempotencyKey: c.idempotencyKey, requestHash: c.requestHash }); return { approvalId: r.id }; }); }
  startExecution(c: MutationContext, b: any) { return this.run(c.actor, async (tx: any) => { const r = await tx.admitExecution({ id: randomUUID(), approvalId: b.approvalId, actorId: c.actor.actorId, jobId: randomUUID(), idempotencyKey: c.idempotencyKey, requestHash: c.requestHash }); return { executionId: r.id, status: r.state }; }); }
  getExecution(a: ActorContext, id: string) { return this.run(a, async (tx: any) => {
    const detail = await tx.getExecutionDetail(id); if (!detail) return null;
    const execution = detail.execution as Record<string, any>; this.owner(a, execution.actor_id ?? execution.actorId);
    const plan = ((detail.plan as any).body ?? detail.plan) as Record<string, any>;
    const attempts = detail.attempts as Record<string, any>[];
    const rows = (detail.rows as Record<string, any>[]).map((row) => { const rowId = row.row_id ?? row.rowId; const effects = (plan.perRecordEffects ?? []).filter((effect: any) => effect.recordId === rowId); return { rowId, resourceRef: row.resource_ref ?? row.resourceRef, state: row.state, steps: effects.map((effect: any) => { const attempt = attempts.filter((item) => (item.row_id ?? item.rowId) === rowId && (item.step_id ?? item.stepId) === effect.stepId).at(-1); return { stepId: effect.stepId, capability: effect.capability, state: stepViewState(effect.expected, attempt?.state), ...(attempt?.error_code ? { reasonCode: attempt.error_code } : {}) }; }) }; });
    return { id: execution.id, tenantId: a.tenantId, planId: execution.plan_id ?? execution.planId, planVersion: Number(execution.plan_version ?? execution.planVersion), approvalId: execution.approval_id ?? execution.approvalId, actorId: execution.actor_id ?? execution.actorId, ...(execution.prior_execution_id ? { priorExecutionId: execution.prior_execution_id } : {}), state: execution.state, revision: Number(execution.revision), rows, ...(execution.cancel_requested_at ? { cancelRequestedAt: new Date(execution.cancel_requested_at).toISOString() } : {}), ...(execution.deadline_at ? { deadlineAt: new Date(execution.deadline_at).toISOString() } : {}), createdAt: new Date(execution.created_at).toISOString(), updatedAt: new Date(execution.updated_at).toISOString(), permissions: uiPermissions(a) };
  }); }
  cancelExecution(c: MutationContext, id: string) { return this.run(c.actor, async (tx: any) => { const r = await tx.getExecution(id); this.owner(c.actor, r?.actorId); return r ? tx.cancelExecution(id, c) : null; }); }
  resumeExecution(c: MutationContext, id: string) { return this.run(c.actor, async (tx: any) => { const r = await tx.getExecution(id); this.owner(c.actor, r?.actorId); return r ? tx.enqueueReconciliation({ executionId: id, jobId: randomUUID(), idempotencyKey: c.idempotencyKey, requestHash: c.requestHash }) : null; }); }
  getInstallations(a: ActorContext) { return this.run(a, async (tx: any) => {
    const permissions = uiPermissions(a);
    const records = await tx.listInstallationDetails();
    return { installations: records.map((record: any) => ({ id: record.id, artifactHash: record.artifactHash, recipeKey: record.recipeKey, displayName: record.displayName, version: record.version, state: record.status, policyVersion: record.policyVersion, evidenceStatus: record.evidenceStatus, permissions, installedAt: record.installedAt.toISOString(), ...(record.lastValidatedAt ? { lastValidatedAt: record.lastValidatedAt.toISOString() } : {}) })), permissions, identity: uiIdentity(a) };
  }); }
  async createInstallation(c: MutationContext, b: any) { if (!this.catalog) throw new ApiError(503, "AUTHORIZED_CATALOG_UNAVAILABLE", "Installation requires catalog authorization", true); const allowed = this.resourceIds[c.actor.tenantId] ?? { category: [], channel: [] }; return this.catalog.installAuthorized({ actor: catalogActor(c.actor), artifactHash: b.artifactHash, bindings: b.configuration, policyVersion: c.actor.policyVersion, idempotencyKey: c.idempotencyKey, adapter: { id: "medusa-v2", capabilityContract: "1", version: "2.22.1" }, approvedCapabilities: ["medusa.products.list","medusa.products.retrieve","medusa.product_categories.retrieve","medusa.sales_channels.retrieve","medusa.product_categories.products.add","medusa.sales_channels.products.add"], allowedResourceIds: { categoryId: allowed.category, channelId: allowed.channel } }); }
  disableInstallation(c: MutationContext, id: string) { return this.run(c.actor, (tx: any) => tx.disableInstallation(id, c)); }
  async createPublication(c: MutationContext, b: any) { if (!this.catalog || !this.publicationKeyId) throw new ApiError(503, "PUBLICATION_SIGNER_UNAVAILABLE", "Publication signer is not configured", true); const allowed = Object.keys(this.resourceIds).filter((tenantId) => tenantId !== c.actor.tenantId); const recipients: string[] = b.allowedTenantIds ?? allowed; if (recipients.some((id) => !allowed.includes(id)) || recipients.length < 1) throw forbidden(); return this.catalog.publishAuthorized({ actor: catalogActor(c.actor), sourceArtifactHash: b.artifactHash, visibility: b.visibility, allowedTenantIds: recipients, consent: true, keyId: this.publicationKeyId, idempotencyKey: c.idempotencyKey }); }
  withdrawPublication(c: MutationContext, id: string) { return this.catalog ? this.catalog.withdrawAuthorized({ actor: catalogActor(c.actor), publicationId: id, idempotencyKey: c.idempotencyKey }) : this.run(c.actor, (tx: any) => tx.updatePublicationState(id, "withdrawn", c)); }
  revokePublication(c: MutationContext, id: string, b: any) { return this.catalog ? this.catalog.securityRevokeAuthorized({ actor: catalogActor(c.actor), publicationId: id, reason: b.reason, idempotencyKey: c.idempotencyKey }) : this.run(c.actor, (tx: any) => tx.updatePublicationState(id, "security_revoked", c)); }
  getEvidence(a: ActorContext, id: string) { return this.run(a, (tx: any) => tx.getEvidence(id)); }
  private run<T>(a: ActorContext, work: (tx: any) => Promise<T>): Promise<T> { return this.store.withTenant({ tenantId: a.tenantId, actorId: a.actorId }, work); }
  private owner(a: ActorContext, owner?: string) { if (owner && owner !== a.actorId) throw forbidden(); }
  private async authorizeDestinations(actor: ActorContext, parameters: Record<string, string>): Promise<void> {
    const allowed = this.resourceIds[actor.tenantId] ?? { category: [], channel: [] };
    for (const [parameter, kind, capability] of [["categoryId", "category", "medusa.product_categories.retrieve"], ["channelId", "channel", "medusa.sales_channels.retrieve"]] as const) {
      const id = parameters[parameter]; if (!id) continue;
      if (!allowed[kind].includes(id)) throw forbidden();
      const value = await this.connector.readAuthorized({ capability, args: { [parameter]: id }, actor });
      if (!resourceHasId(value, id)) throw new ApiError(409, "DESTINATION_STALE", "The approved destination is no longer available", false);
    }
  }
}

function parseProduct(id: string, raw: unknown): ProductSnapshot {
  const x: any = raw;
  const p = x?.result?.product ?? x?.result ?? x?.product ?? x;
  if (!p || p.id !== id || typeof p.protectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(p.protectedDigest)) {
    throw new ApiError(503, "BACKEND_MALFORMED", "Backend product response is malformed", true);
  }
  return {
    id,
    status: String(p.status),
    blocked: p.locked === true || p.metadata?.changedesk_locked === true,
    categoryIds: (p.categories ?? []).map((v: any) => String(v.id)),
    channelIds: (p.sales_channels ?? []).map((v: any) => String(v.id)),
    protectedDigest: p.protectedDigest,
  };
}
function catalogActor(actor: ActorContext) { const role = actor.roles.includes("admin") ? "admin" as const : actor.roles.includes("operator") ? "operator" as const : actor.roles.includes("requester") ? "requester" as const : "viewer" as const; return { tenantId: actor.tenantId, actorId: actor.actorId, role, enabled: true }; }
function uiPermissions(actor: ActorContext): string[] { return actor.roles.includes("admin") ? ["read","request","preview","approve","execute","install","share","revoke","policy.manage"] : actor.roles.includes("operator") ? ["read","request","preview","approve","execute"] : actor.roles.includes("requester") ? ["read","request","preview"] : ["read"]; }
function safeRequestMessage(state: string): string { return ({ received: "Request received.", searching: "Searching authorized functions.", candidate_offered: "Compatible functions are ready for review.", generating: "Generating a bounded proposal.", needs_configuration: "Configuration is required.", needs_clarification: "More information is required.", plan_ready: "Plan ready for review.", rejected: "The request was rejected.", error: "The request could not be completed." } as Record<string,string>)[state] ?? "Request status unavailable."; }
function resourceLabel(id: string, value: unknown): string {
  if (!value || typeof value !== "object") return id;
  const record = value as Record<string, unknown>;
  const nested = (record.product_category ?? record.sales_channel ?? record.category ?? record.channel) as Record<string, unknown> | undefined;
  const label = nested?.name ?? nested?.title ?? record.name ?? record.title;
  return typeof label === "string" && label.trim() ? label.slice(0, 200) : id;
}
function resourceHasId(value: unknown, id: string): boolean { if (!value || typeof value !== "object") return false; const record = value as Record<string, unknown>; const nested = (record.product_category ?? record.sales_channel ?? record.category ?? record.channel) as Record<string, unknown> | undefined; return (nested?.id ?? record.id) === id; }
function sameKeys(left: readonly string[], right: readonly string[]): boolean { const expected = [...right].sort(); return left.length === expected.length && [...left].sort().every((key, index) => key === expected[index]); }
function stepViewState(expected: string, attemptState?: string): string { if (expected === "no_op") return "skipped"; return ({ intent_recorded: "running", sent: "unknown", unknown: "unknown", confirmed: "succeeded", no_effect: "skipped", rejected: "failed" } as Record<string, string>)[attemptState ?? ""] ?? "pending"; }
function uiIdentity(actor: ActorContext) { const role = actor.roles.includes("admin") ? "admin" : actor.roles.includes("operator") ? "operator" : actor.roles.includes("requester") ? "requester" : "viewer"; return { tenantName: actor.tenantId, actorName: actor.actorId, role, scopeId: hashCanonical("ui-scope", "1", { tenantId: actor.tenantId, actorId: actor.actorId }) }; }
