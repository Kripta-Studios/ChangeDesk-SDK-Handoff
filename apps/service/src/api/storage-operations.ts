import { randomUUID } from "node:crypto";
import type { JsonValue, Recipe } from "@changedesk/contracts";
import { Store } from "../storage/index.js";
import type { ActorContext, HostConnector, ProductSnapshot } from "../runtime/types.js";
import { compilePlan } from "../runtime/compiler.js";
import { ApiError, forbidden, notFound } from "./errors.js";
import type { ApiOperations, MutationContext } from "./ports.js";

export class StorageApiOperations implements ApiOperations {
  constructor(private readonly store: Store, private readonly connector: HostConnector, private readonly resourceIds: Readonly<Record<string, { category: readonly string[]; channel: readonly string[] }>>, private readonly clock = () => new Date()) {}
  createRequest(c: MutationContext, b: any) { return this.run(c.actor, async (tx: any) => { const r = await tx.createRequestAndJob({ id: randomUUID(), actorId: c.actor.actorId, redactedText: b.message, contextRef: { selectedProductIds: b.selectedProductIds, locale: b.locale ?? "es", clientRequestId: b.clientRequestId }, budget: {}, jobId: randomUUID(), idempotencyKey: c.idempotencyKey, requestHash: c.requestHash }); return { requestId: r.id, status: r.state }; }); }
  getRequest(a: ActorContext, id: string) { return this.run(a, async (tx: any) => { const r = await tx.getRequest(id); this.owner(a, r?.actorId); return r && { requestId: r.id, status: r.state, safeMessage: "", candidates: [], createdAt: r.createdAt.toISOString(), updatedAt: r.createdAt.toISOString() }; }); }
  addMessage(c: MutationContext, id: string, b: any) { return this.run(c.actor, async (tx: any) => { const r = await tx.getRequest(id); this.owner(c.actor, r?.actorId); if (!r) throw notFound(); const m = await tx.addRequestMessage({ id: randomUUID(), requestId: id, clientRequestId: b.clientRequestId, redactedText: b.message }); return { requestId: id, messageId: m.id, status: r.state }; }); }
  async getCandidates() { throw new ApiError(503, "REQUEST_CANDIDATES_UNAVAILABLE", "Request-bound candidates are unavailable", true); }
  async selectCandidate() { throw new ApiError(503, "REQUEST_CANDIDATES_UNAVAILABLE", "Request-bound candidates are unavailable", true); }
  async getResources(a: ActorContext, kind: "category" | "channel", q: { limit?: number }) { const capability = kind === "category" ? "medusa.product_categories.retrieve" as const : "medusa.sales_channels.retrieve" as const; const items = await Promise.all((this.resourceIds[a.tenantId]?.[kind] ?? []).slice(0, q.limit ?? 50).map(async (id) => ({ id, detail: await this.connector.readAuthorized({ capability, args: kind === "category" ? { categoryId: id } : { channelId: id }, actor: a }) }))); return { items, nextCursor: null }; }
  async createPlan() { throw new ApiError(503, "ACTIVE_CAPABILITY_MANIFEST_UNAVAILABLE", "Plan compilation requires an active persisted capability manifest", true); }
  getPlan(a: ActorContext, id: string) { return this.run(a, async (tx: any) => { const r = await tx.getPlan(id); this.owner(a, r?.actorId); return r; }); }
  createApproval(c: MutationContext, b: any) { return this.run(c.actor, async (tx: any) => { const p = await tx.getPlan(b.planId); this.owner(c.actor, p?.actorId); if (!p) throw notFound(); const r = await tx.createApproval({ id: randomUUID(), planId: b.planId, planVersion: b.expectedPlanVersion, planHash: b.planHash, actorId: c.actor.actorId, scope: ["execute"], expiresAt: new Date(Math.min(p.expiresAt.getTime(), this.clock().getTime() + 600_000)), idempotencyKey: c.idempotencyKey, requestHash: c.requestHash }); return { approvalId: r.id }; }); }
  startExecution(c: MutationContext, b: any) { return this.run(c.actor, async (tx: any) => { const r = await tx.admitExecution({ id: randomUUID(), approvalId: b.approvalId, actorId: c.actor.actorId, jobId: randomUUID(), idempotencyKey: c.idempotencyKey, requestHash: c.requestHash }); return { executionId: r.id, status: r.state }; }); }
  getExecution(a: ActorContext, id: string) { return this.run(a, async (tx: any) => { const r = await tx.getExecution(id); this.owner(a, r?.actorId); return r; }); }
  cancelExecution(c: MutationContext, id: string) { return this.run(c.actor, async (tx: any) => { const r = await tx.getExecution(id); this.owner(c.actor, r?.actorId); return r ? tx.cancelExecution(id, c) : null; }); }
  resumeExecution(c: MutationContext, id: string) { return this.run(c.actor, async (tx: any) => { const r = await tx.getExecution(id); this.owner(c.actor, r?.actorId); return r ? tx.enqueueReconciliation({ executionId: id, jobId: randomUUID(), idempotencyKey: c.idempotencyKey, requestHash: c.requestHash }) : null; }); }
  getInstallations(a: ActorContext) { return this.run(a, async (tx: any) => ({ installations: await tx.listInstallations(), permissions: a.roles })); }
  async createInstallation() { throw new ApiError(503, "AUTHORIZED_CATALOG_UNAVAILABLE", "Installation requires catalog authorization", true); }
  disableInstallation(c: MutationContext, id: string) { return this.run(c.actor, (tx: any) => tx.disableInstallation(id, c)); }
  async createPublication() { throw new ApiError(503, "PUBLICATION_SIGNER_UNAVAILABLE", "Publication signer is not configured", true); }
  withdrawPublication(c: MutationContext, id: string) { return this.run(c.actor, (tx: any) => tx.updatePublicationState(id, "withdrawn", c)); }
  revokePublication(c: MutationContext, id: string) { return this.run(c.actor, (tx: any) => tx.updatePublicationState(id, "security_revoked", c)); }
  async getEvidence() { throw new ApiError(503, "EVIDENCE_READ_UNAVAILABLE", "Evidence read storage is unavailable", true); }
  private run<T>(a: ActorContext, work: (tx: any) => Promise<T>): Promise<T> { return this.store.withTenant({ tenantId: a.tenantId, actorId: a.actorId }, work); }
  private owner(a: ActorContext, owner?: string) { if (owner && owner !== a.actorId) throw forbidden(); }
}

function parseProduct(id: string, raw: unknown): ProductSnapshot { const x: any = raw; const p = x?.result?.product ?? x?.result ?? x?.product ?? x; if (!p || p.id !== id) throw new ApiError(503, "BACKEND_MALFORMED", "Backend product response is malformed", true); return { id, status: String(p.status), blocked: p.locked === true || p.metadata?.changedesk_locked === true, categoryIds: (p.categories ?? []).map((v: any) => String(v.id)), channelIds: (p.sales_channels ?? []).map((v: any) => String(v.id)), protectedDigest: String(p.protectedDigest ?? p.updated_at ?? "unknown") }; }
