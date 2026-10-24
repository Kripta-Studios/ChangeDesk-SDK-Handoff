import { randomUUID } from "node:crypto";
import type { JsonValue, Recipe } from "@changedesk/contracts";
import { Store } from "../storage/index.js";
import type { ActorContext, HostConnector, ProductSnapshot } from "../runtime/types.js";
import { compilePlan } from "../runtime/compiler.js";
import { ApiError, forbidden, notFound } from "./errors.js";
import type { ApiOperations, MutationContext } from "./ports.js";
import type { CatalogPort } from "../planner/index.js";

export class StorageApiOperations implements ApiOperations {
  constructor(private readonly store: Store, private readonly connector: HostConnector, private readonly resourceIds: Readonly<Record<string, { category: readonly string[]; channel: readonly string[] }>>, private readonly catalog?: CatalogPort, private readonly publicationKeyId?: string, private readonly clock = () => new Date()) {}
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
  async createPlan() { throw new ApiError(503, "ACTIVE_CAPABILITY_MANIFEST_UNAVAILABLE", "Plan compilation requires an active persisted capability manifest", true); }
  getPlan(a: ActorContext, id: string) { return this.run(a, async (tx: any) => {
    const detail = await tx.getPlanDetail(id); this.owner(a, detail?.actorId); if (!detail) return null;
    const body = detail.body as Record<string, unknown>;
    const plan = { ...body, id: detail.id, requestId: detail.requestId, artifactHash: detail.artifactHash, adapterVersion: detail.adapterVersion, policyVersion: detail.policyVersion, capabilityManifestHash: detail.capabilityManifestHash, planVersion: detail.planVersion, planHash: detail.planHash, state: detail.state, expiresAt: detail.expiresAt.toISOString(), createdAt: detail.createdAt.toISOString() };
    const permissions = uiPermissions(a);
    return { plan, title: "Change plan", canApprove: detail.state === "ready" && permissions.includes("approve"), permissions };
  }); }
  createApproval(c: MutationContext, b: any) { return this.run(c.actor, async (tx: any) => { const p = await tx.getPlan(b.planId); this.owner(c.actor, p?.actorId); if (!p) throw notFound(); const r = await tx.createApproval({ id: randomUUID(), planId: b.planId, planVersion: b.expectedPlanVersion, planHash: b.planHash, actorId: c.actor.actorId, hostSessionId: c.actor.hostSessionId, scope: ["execute"], expiresAt: new Date(Math.min(p.expiresAt.getTime(), this.clock().getTime() + 600_000)), idempotencyKey: c.idempotencyKey, requestHash: c.requestHash }); return { approvalId: r.id }; }); }
  startExecution(c: MutationContext, b: any) { return this.run(c.actor, async (tx: any) => { const r = await tx.admitExecution({ id: randomUUID(), approvalId: b.approvalId, actorId: c.actor.actorId, jobId: randomUUID(), idempotencyKey: c.idempotencyKey, requestHash: c.requestHash }); return { executionId: r.id, status: r.state }; }); }
  getExecution(a: ActorContext, id: string) { return this.run(a, async (tx: any) => { const r = await tx.getExecution(id); this.owner(a, r?.actorId); return r; }); }
  cancelExecution(c: MutationContext, id: string) { return this.run(c.actor, async (tx: any) => { const r = await tx.getExecution(id); this.owner(c.actor, r?.actorId); return r ? tx.cancelExecution(id, c) : null; }); }
  resumeExecution(c: MutationContext, id: string) { return this.run(c.actor, async (tx: any) => { const r = await tx.getExecution(id); this.owner(c.actor, r?.actorId); return r ? tx.enqueueReconciliation({ executionId: id, jobId: randomUUID(), idempotencyKey: c.idempotencyKey, requestHash: c.requestHash }) : null; }); }
  getInstallations(a: ActorContext) { return this.run(a, async (tx: any) => {
    const permissions = uiPermissions(a);
    const records = await tx.listInstallationDetails();
    return { installations: records.map((record: any) => ({ id: record.id, artifactHash: record.artifactHash, recipeKey: record.recipeKey, displayName: record.displayName, version: record.version, state: record.status, policyVersion: record.policyVersion, evidenceStatus: record.evidenceStatus, permissions, installedAt: record.installedAt.toISOString(), ...(record.lastValidatedAt ? { lastValidatedAt: record.lastValidatedAt.toISOString() } : {}) })), permissions };
  }); }
  async createInstallation(c: MutationContext, b: any) { if (!this.catalog) throw new ApiError(503, "AUTHORIZED_CATALOG_UNAVAILABLE", "Installation requires catalog authorization", true); const allowed = this.resourceIds[c.actor.tenantId] ?? { category: [], channel: [] }; return this.catalog.installAuthorized({ actor: catalogActor(c.actor), artifactHash: b.artifactHash, bindings: b.configuration, policyVersion: c.actor.policyVersion, idempotencyKey: c.idempotencyKey, adapter: { id: "medusa-v2", capabilityContract: "1", version: "2.22.1" }, approvedCapabilities: ["medusa.products.list","medusa.products.retrieve","medusa.product_categories.retrieve","medusa.sales_channels.retrieve","medusa.product_categories.products.add","medusa.sales_channels.products.add"], allowedResourceIds: { categoryId: allowed.category, channelId: allowed.channel } }); }
  disableInstallation(c: MutationContext, id: string) { return this.run(c.actor, (tx: any) => tx.disableInstallation(id, c)); }
  async createPublication(c: MutationContext, b: any) { if (!this.catalog || !this.publicationKeyId) throw new ApiError(503, "PUBLICATION_SIGNER_UNAVAILABLE", "Publication signer is not configured", true); const allowed = Object.keys(this.resourceIds).filter((tenantId) => tenantId !== c.actor.tenantId); const recipients: string[] = b.allowedTenantIds ?? allowed; if (recipients.some((id) => !allowed.includes(id)) || recipients.length < 1) throw forbidden(); return this.catalog.publishAuthorized({ actor: catalogActor(c.actor), sourceArtifactHash: b.artifactHash, visibility: b.visibility, allowedTenantIds: recipients, consent: true, keyId: this.publicationKeyId, idempotencyKey: c.idempotencyKey }); }
  withdrawPublication(c: MutationContext, id: string) { return this.catalog ? this.catalog.withdrawAuthorized({ actor: catalogActor(c.actor), publicationId: id, idempotencyKey: c.idempotencyKey }) : this.run(c.actor, (tx: any) => tx.updatePublicationState(id, "withdrawn", c)); }
  revokePublication(c: MutationContext, id: string, b: any) { return this.catalog ? this.catalog.securityRevokeAuthorized({ actor: catalogActor(c.actor), publicationId: id, reason: b.reason, idempotencyKey: c.idempotencyKey }) : this.run(c.actor, (tx: any) => tx.updatePublicationState(id, "security_revoked", c)); }
  getEvidence(a: ActorContext, id: string) { return this.run(a, (tx: any) => tx.getEvidence(id)); }
  private run<T>(a: ActorContext, work: (tx: any) => Promise<T>): Promise<T> { return this.store.withTenant({ tenantId: a.tenantId, actorId: a.actorId }, work); }
  private owner(a: ActorContext, owner?: string) { if (owner && owner !== a.actorId) throw forbidden(); }
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
