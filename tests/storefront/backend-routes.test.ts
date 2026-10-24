import Fastify, { type FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { registerStorefrontRoutes } from "../../apps/service/src/storefront/routes.js";
import type {
  BuyerContext,
  RepositoryResult,
  StorefrontAdminContext,
  StorefrontAdminPreview,
  StorefrontOverrides,
  StorefrontPreferences,
  StorefrontProposal,
  StorefrontRepository,
} from "../../apps/service/src/storefront/types.js";

const COMPLETE = { theme: "system", density: "comfortable", productLayout: "grid" } as const;

class TestStorefrontRepository implements StorefrontRepository {
  readonly globals = new Map<string, { values: typeof COMPLETE; revision: number }>();
  readonly buyers = new Map<string, { overrides: StorefrontOverrides; revision: number }>();
  readonly proposals = new Map<string, StorefrontProposal>();
  readonly idempotency = new Map<string, { fingerprint: string; value: unknown }>();
  proposalSequence = 0;

  private global(tenantId: string) {
    return this.globals.get(tenantId) ?? { values: COMPLETE, revision: 0 };
  }
  private buyerKey(context: BuyerContext) { return `${context.tenantId}:${context.buyerId}`; }
  async getPreferences(context: BuyerContext): Promise<StorefrontPreferences> {
    const global = this.global(context.tenantId);
    const buyer = this.buyers.get(this.buyerKey(context)) ?? { overrides: {}, revision: 0 };
    return { overrides: buyer.overrides, effective: { ...global.values, ...buyer.overrides }, buyerRevision: buyer.revision, globalRevision: global.revision };
  }
  async replacePreferences(input: Parameters<StorefrontRepository["replacePreferences"]>[0]): Promise<RepositoryResult<StorefrontPreferences>> {
    const idemKey = `${input.context.tenantId}:buyer:${input.context.buyerId}:replace:${input.idempotencyKey}`;
    const prior = this.idempotency.get(idemKey);
    if (prior) return prior.fingerprint === input.requestFingerprint
      ? { ok: true, value: prior.value as StorefrontPreferences, replayed: true }
      : { ok: false, code: "conflict", reason: "idempotency_key_reused" };
    const current = await this.getPreferences(input.context);
    if (current.buyerRevision !== input.expectedRevision) return { ok: false, code: "conflict", reason: "stale_buyer_revision" };
    this.buyers.set(this.buyerKey(input.context), { overrides: input.overrides, revision: current.buyerRevision + 1 });
    const value = await this.getPreferences(input.context);
    this.idempotency.set(idemKey, { fingerprint: input.requestFingerprint, value });
    return { ok: true, value };
  }
  async createProposal(input: Parameters<StorefrontRepository["createProposal"]>[0]): Promise<RepositoryResult<StorefrontProposal>> {
    const idemKey = `${input.context.tenantId}:buyer:${input.context.buyerId}:proposal:${input.idempotencyKey}`;
    const prior = this.idempotency.get(idemKey);
    if (prior) return prior.fingerprint === input.requestFingerprint
      ? { ok: true, value: prior.value as StorefrontProposal, replayed: true }
      : { ok: false, code: "conflict", reason: "idempotency_key_reused" };
    if (this.global(input.context.tenantId).revision !== input.baseGlobalRevision) return { ok: false, code: "conflict", reason: "stale_global_revision" };
    const ownPending = [...this.proposals.values()].filter((p) => p.tenantId === input.context.tenantId && p.buyerId === input.context.buyerId && p.status === "pending").length;
    const tenantPending = [...this.proposals.values()].filter((p) => p.tenantId === input.context.tenantId && p.status === "pending").length;
    if (ownPending >= 5 || tenantPending >= 100) return { ok: false, code: "quota", reason: "pending_proposal_quota" };
    const value: StorefrontProposal = { id: `proposal-${++this.proposalSequence}`, tenantId: input.context.tenantId, buyerId: input.context.buyerId, baseGlobalRevision: input.baseGlobalRevision, proposed: input.proposed, status: "pending", proposalRevision: 1, createdAt: "2026-10-24T12:00:00.000Z" };
    this.proposals.set(value.id, value); this.idempotency.set(idemKey, { fingerprint: input.requestFingerprint, value });
    return { ok: true, value };
  }
  async getBuyerProposal(context: BuyerContext, proposalId: string): Promise<RepositoryResult<StorefrontProposal>> {
    const value = this.proposals.get(proposalId);
    return value?.tenantId === context.tenantId && value.buyerId === context.buyerId ? { ok: true, value } : { ok: false, code: "not_found", reason: "proposal_not_found" };
  }
  private preview(context: StorefrontAdminContext, id: string): RepositoryResult<StorefrontAdminPreview> {
    const proposal = this.proposals.get(id);
    if (!proposal || proposal.tenantId !== context.tenantId) return { ok: false, code: "not_found", reason: "proposal_not_found" };
    const global = this.global(context.tenantId);
    return { ok: true, value: { proposalId: id, proposalRevision: proposal.proposalRevision, current: global.values, proposed: proposal.proposed, globalRevision: global.revision, precedenceNotice: "Personal overrides remain unchanged and take precedence.", status: proposal.status } };
  }
  async listAdminProposals(context: StorefrontAdminContext) { return [...this.proposals.values()].filter((p) => p.tenantId === context.tenantId).slice(0, 50).map((p) => (this.preview(context, p.id) as {ok:true; value: StorefrontAdminPreview}).value); }
  async getAdminProposal(context: StorefrontAdminContext, proposalId: string) { return this.preview(context, proposalId); }
  async approveProposal(input: Parameters<StorefrontRepository["approveProposal"]>[0]): Promise<RepositoryResult<StorefrontAdminPreview>> {
    const idemKey = `${input.context.tenantId}:staff:${input.context.actorId}:approve:${input.idempotencyKey}`;
    const prior = this.idempotency.get(idemKey);
    if (prior) return prior.fingerprint === input.requestFingerprint ? { ok: true, value: prior.value as StorefrontAdminPreview, replayed: true } : { ok: false, code: "conflict", reason: "idempotency_key_reused" };
    const proposal = this.proposals.get(input.proposalId);
    const global = this.global(input.context.tenantId);
    if (!proposal || proposal.tenantId !== input.context.tenantId) return { ok: false, code: "not_found", reason: "proposal_not_found" };
    if (proposal.status !== "pending" || proposal.proposalRevision !== input.expectedProposalRevision || global.revision !== input.expectedGlobalRevision || proposal.baseGlobalRevision !== global.revision) return { ok: false, code: "conflict", reason: "stale_proposal" };
    this.globals.set(input.context.tenantId, { values: proposal.proposed, revision: global.revision + 1 });
    this.proposals.set(proposal.id, { ...proposal, status: "approved", proposalRevision: proposal.proposalRevision + 1, decidedAt: "2026-10-24T12:01:00.000Z" });
    const value = (this.preview(input.context, proposal.id) as {ok:true; value: StorefrontAdminPreview}).value;
    this.idempotency.set(idemKey, { fingerprint: input.requestFingerprint, value }); return { ok: true, value };
  }
  async rejectProposal(input: Parameters<StorefrontRepository["rejectProposal"]>[0]): Promise<RepositoryResult<StorefrontAdminPreview>> {
    const proposal = this.proposals.get(input.proposalId);
    if (!proposal || proposal.tenantId !== input.context.tenantId) return { ok: false, code: "not_found", reason: "proposal_not_found" };
    if (proposal.status !== "pending" || proposal.proposalRevision !== input.expectedProposalRevision) return { ok: false, code: "conflict", reason: "stale_proposal" };
    this.proposals.set(proposal.id, { ...proposal, status: "rejected", proposalRevision: proposal.proposalRevision + 1, decidedAt: "2026-10-24T12:01:00.000Z" });
    return this.preview(input.context, proposal.id);
  }
}

const buyer = (tenantId: string, buyerId: string): BuyerContext => ({ kind: "buyer", tenantId, buyerId, hostSessionId: `host-${buyerId}`, policyVersion: "p1", expiresAt: "2099-01-01T00:00:00.000Z" });
const admin = (tenantId: string, actorId = "admin-1"): StorefrontAdminContext => ({ kind: "staff", tenantId, actorId, role: "admin", policyVersion: "p1", expiresAt: "2099-01-01T00:00:00.000Z" });

describe("storefront Fastify routes", () => {
  let repository: TestStorefrontRepository;
  beforeEach(() => { repository = new TestStorefrontRepository(); });

  async function build() {
    const app = Fastify();
    const tokens = new Map<string, BuyerContext | StorefrontAdminContext>([["buyer-a", buyer("atlas", "same-id")], ["buyer-b", buyer("atlas", "buyer-b")], ["buyer-boreal", buyer("boreal", "buyer-b")], ["admin-a", admin("atlas", "same-id")], ["operator-a", { ...admin("atlas", "operator"), role: "operator" }], ["expired", { ...buyer("atlas", "expired"), expiresAt: "2020-01-01T00:00:00.000Z" }], ["invalid-expiry", { ...buyer("atlas", "invalid"), expiresAt: "not-a-date" }], ["admin-boreal", admin("boreal")]]);
    const resolve = (request: FastifyRequest) => tokens.get(String(request.headers.authorization).replace("Bearer ", ""));
    await registerStorefrontRoutes(app, { repository, authenticateBuyer: async (request) => { const value = resolve(request); return value?.kind === "buyer" ? value : null; }, authenticateAdmin: async (request) => { const value = resolve(request); return value?.kind === "staff" ? value : null; } });
    return app;
  }
  const headers = (token: string, key?: string) => ({ authorization: `Bearer ${token}`, ...(key ? { "idempotency-key": key } : {}) });

  it("isolates personal overrides across buyers and tenants and resets with an empty object", async () => {
    const app = await build();
    const changed = await app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("buyer-a", "00000000-0000-4000-8000-000000000001"), payload: { expectedRevision: 0, overrides: { theme: "dark" } } });
    expect(changed.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: headers("buyer-b") })).json().overrides).toEqual({});
    expect((await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: headers("buyer-boreal") })).json().overrides).toEqual({});
    const reset = await app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("buyer-a", "00000000-0000-4000-8000-000000000002"), payload: { expectedRevision: 1, overrides: {} } });
    expect(reset.json()).toMatchObject({ overrides: {}, buyerRevision: 2, effective: COMPLETE });
  });

  it("rejects crossed staff/buyer auth even when buyerId equals actorId, unknown fields, null, code and URLs", async () => {
    const app = await build();
    expect((await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: headers("admin-a") })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/storefront/admin/global-change-proposals", headers: headers("buyer-a") })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/storefront/admin/global-change-proposals", headers: headers("operator-a") })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: headers("expired") })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: headers("invalid-expiry") })).statusCode).toBe(401);
    for (const overrides of [{ theme: null }, { theme: "javascript:alert(1)" }, { productLayout: "https://evil.invalid" }, { density: "compact", css: "body{}" }]) {
      const response = await app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("buyer-a", crypto.randomUUID()), payload: { expectedRevision: 0, overrides } });
      expect(response.statusCode).toBe(422);
    }
    expect(repository.buyers.size).toBe(0);
  });

  it("uses CAS and body-bound idempotency without effects on conflicts", async () => {
    const app = await build(); const key = "00000000-0000-4000-8000-000000000010";
    const first = await app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("buyer-a", key), payload: { expectedRevision: 0, overrides: { theme: "dark", density: "compact" } } });
    const replay = await app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("buyer-a", key), payload: { overrides: { density: "compact", theme: "dark" }, expectedRevision: 0 } });
    expect(replay.json()).toEqual(first.json());
    expect((await app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("buyer-a", key), payload: { expectedRevision: 1, overrides: { theme: "dark" } } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("buyer-a", crypto.randomUUID()), payload: { expectedRevision: 0, overrides: {} } })).statusCode).toBe(409);
    expect((await repository.getPreferences(buyer("atlas", "same-id"))).buyerRevision).toBe(1);
  });

  it("creates an immutable proposal without effect and hides other buyers and tenants as 404", async () => {
    const app = await build();
    const response = await app.inject({ method: "POST", url: "/v1/storefront/global-change-proposals", headers: headers("buyer-a", crypto.randomUUID()), payload: { baseGlobalRevision: 0, proposed: { theme: "dark", density: "compact", productLayout: "list" } } });
    expect(response.statusCode).toBe(201); const proposal = response.json();
    expect(repository.globals.has("atlas")).toBe(false);
    expect((await app.inject({ method: "GET", url: `/v1/storefront/global-change-proposals/${proposal.id}`, headers: headers("buyer-b") })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/storefront/global-change-proposals/${proposal.id}`, headers: headers("buyer-boreal") })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/storefront/global-change-proposals/${proposal.id}`, headers: headers("buyer-a") })).headers["cache-control"]).toBe("no-store");
  });

  it("allows only same-tenant admin to approve exact revisions and preserves overrides", async () => {
    const app = await build();
    await repository.replacePreferences({ context: buyer("atlas", "same-id"), expectedRevision: 0, overrides: { theme: "light" }, idempotencyKey: crypto.randomUUID(), requestFingerprint: "personal" });
    const created = await app.inject({ method: "POST", url: "/v1/storefront/global-change-proposals", headers: headers("buyer-a", crypto.randomUUID()), payload: { baseGlobalRevision: 0, proposed: { theme: "dark", density: "compact", productLayout: "list" } } });
    const id = created.json().id;
    expect((await app.inject({ method: "GET", url: `/v1/storefront/admin/global-change-proposals/${id}`, headers: headers("admin-boreal") })).statusCode).toBe(404);
    const approved = await app.inject({ method: "POST", url: `/v1/storefront/admin/global-change-proposals/${id}/approve`, headers: headers("admin-a", crypto.randomUUID()), payload: { expectedProposalRevision: 1, expectedGlobalRevision: 0 } });
    expect(approved.statusCode).toBe(200);
    expect((await repository.getPreferences(buyer("atlas", "same-id"))).effective).toEqual({ theme: "light", density: "compact", productLayout: "list" });
    expect((await app.inject({ method: "POST", url: `/v1/storefront/admin/global-change-proposals/${id}/approve`, headers: headers("admin-a", crypto.randomUUID()), payload: { expectedProposalRevision: 1, expectedGlobalRevision: 0 } })).statusCode).toBe(409);
  });

  it("rejects a proposal without changing globals and returns private no-store responses", async () => {
    const app = await build();
    const created = await app.inject({ method: "POST", url: "/v1/storefront/global-change-proposals", headers: headers("buyer-a", crypto.randomUUID()), payload: { baseGlobalRevision: 0, proposed: { theme: "dark", density: "compact", productLayout: "list" } } });
    const rejected = await app.inject({ method: "POST", url: `/v1/storefront/admin/global-change-proposals/${created.json().id}/reject`, headers: headers("admin-a", crypto.randomUUID()), payload: { expectedProposalRevision: 1 } });
    expect(rejected.statusCode).toBe(200); expect(rejected.json().status).toBe("rejected");
    expect(repository.globals.has("atlas")).toBe(false); expect(rejected.headers["cache-control"]).toBe("no-store");
  });

  it("enforces pending quota, 64 KiB bodies, and uniform dependency errors", async () => {
    const app = await build();
    for (let index = 0; index < 5; index++) {
      const response = await app.inject({ method: "POST", url: "/v1/storefront/global-change-proposals", headers: headers("buyer-a", crypto.randomUUID()), payload: { baseGlobalRevision: 0, proposed: { theme: "dark", density: "compact", productLayout: "list" } } });
      expect(response.statusCode).toBe(201);
    }
    const quota = await app.inject({ method: "POST", url: "/v1/storefront/global-change-proposals", headers: headers("buyer-a", crypto.randomUUID()), payload: { baseGlobalRevision: 0, proposed: { theme: "dark", density: "compact", productLayout: "list" } } });
    expect(quota.statusCode).toBe(429); expect(quota.headers["retry-after"]).toBe("60");
    const huge = await app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: { ...headers("buyer-a", crypto.randomUUID()), "content-type": "application/json" }, payload: JSON.stringify({ expectedRevision: 0, overrides: {}, padding: "x".repeat(70_000) }) });
    expect(huge.statusCode).toBe(413); expect(huge.json().error.code).toBe("body_too_large");
    repository.getPreferences = async () => { throw new Error("database secret detail"); };
    const unavailable = await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: headers("buyer-b") });
    expect(unavailable.statusCode).toBe(503); expect(unavailable.body).not.toContain("database secret detail");
  });
});
