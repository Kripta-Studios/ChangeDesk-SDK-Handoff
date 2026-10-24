import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { BuyerContext, RepositoryResult, StorefrontAdminContext, StorefrontOverrides, StorefrontProposal, StorefrontRepository } from "./types.js";

export interface StorefrontRouteDependencies {
  readonly repository: StorefrontRepository;
  readonly authenticateBuyer: (request: FastifyRequest) => Promise<BuyerContext | null>;
  readonly authenticateAdmin: (request: FastifyRequest) => Promise<StorefrontAdminContext | null>;
  readonly now?: () => Date;
  readonly requestId?: () => string;
}

type ObjectRecord = Record<string, unknown>;
const THEMES = new Set(["light", "dark", "system"]);
const DENSITIES = new Set(["comfortable", "compact"]);
const LAYOUTS = new Set(["grid", "list"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is ObjectRecord { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasOnly(value: ObjectRecord, keys: readonly string[]): boolean { const accepted = new Set(keys); return Object.keys(value).every((key) => accepted.has(key)); }
function parseOverrides(value: unknown, complete: boolean): StorefrontOverrides | null {
  if (!isObject(value) || !hasOnly(value, ["theme", "density", "productLayout"])) return null;
  if (complete && Object.keys(value).length !== 3) return null;
  if ("theme" in value && !THEMES.has(value.theme as string)) return null;
  if ("density" in value && !DENSITIES.has(value.density as string)) return null;
  if ("productLayout" in value && !LAYOUTS.has(value.productLayout as string)) return null;
  return value as StorefrontOverrides;
}
function fingerprint(operation: string, body: unknown): string { return createHash("sha256").update(`storefront:${operation}:v1\0${JSON.stringify(body)}`).digest("hex"); }
function privateResponse(reply: FastifyReply): void { void reply.header("Cache-Control", "no-store"); }
function fail(reply: FastifyReply, status: number, code: string, message: string, requestId: string, retryable = false) {
  privateResponse(reply); return reply.code(status).send({ error: { code, message, requestId, retryable } });
}
function repositoryFailure<T>(reply: FastifyReply, result: Exclude<RepositoryResult<T>, { ok: true }>, requestId: string) {
  if (result.code === "not_found") return fail(reply, 404, "not_found", "Resource not found", requestId);
  if (result.code === "quota") { void reply.header("Retry-After", "60"); return fail(reply, 429, "pending_proposal_quota", "Pending proposal quota reached", requestId, true); }
  return fail(reply, 409, result.reason, "The resource changed; reload and review before retrying", requestId);
}
function idempotencyKey(request: FastifyRequest): string | null { const value = request.headers["idempotency-key"]; return typeof value === "string" && UUID.test(value) ? value : null; }
function publicProposal(proposal: StorefrontProposal) {
  return { id: proposal.id, baseGlobalRevision: proposal.baseGlobalRevision, proposed: proposal.proposed, status: proposal.status, proposalRevision: proposal.proposalRevision, createdAt: proposal.createdAt, ...(proposal.decidedAt ? { decidedAt: proposal.decidedAt } : {}) };
}

/** Explicit opt-in route registration. No routes are registered by importing this module. */
export async function registerStorefrontRoutes(app: FastifyInstance, dependencies: StorefrontRouteDependencies): Promise<void> {
  const nextRequestId = dependencies.requestId ?? randomUUID;
  async function requireBuyer(request: FastifyRequest, reply: FastifyReply): Promise<BuyerContext | null> {
    const context = await dependencies.authenticateBuyer(request);
    if (!context || context.kind !== "buyer" || Date.parse(context.expiresAt) <= (dependencies.now?.() ?? new Date()).getTime()) { fail(reply, 401, "buyer_session_required", "A current buyer session is required", nextRequestId()); return null; }
    return context;
  }
  async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<StorefrontAdminContext | null> {
    const context = await dependencies.authenticateAdmin(request);
    if (!context || context.kind !== "staff" || context.role !== "admin" || Date.parse(context.expiresAt) <= (dependencies.now?.() ?? new Date()).getTime()) { fail(reply, 401, "admin_session_required", "A current administrator session is required", nextRequestId()); return null; }
    return context;
  }

  app.get("/v1/storefront/me/preferences", async (request, reply) => {
    privateResponse(reply); const context = await requireBuyer(request, reply); if (!context) return reply;
    return dependencies.repository.getPreferences(context);
  });
  app.put("/v1/storefront/me/preferences", async (request, reply) => {
    privateResponse(reply); const context = await requireBuyer(request, reply); if (!context) return reply;
    const key = idempotencyKey(request); const body = request.body;
    if (!key) return fail(reply, 400, "invalid_idempotency_key", "Idempotency-Key must be a UUID", nextRequestId());
    if (!isObject(body) || !hasOnly(body, ["expectedRevision", "overrides"]) || !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) return fail(reply, 422, "invalid_preferences", "Expected a non-negative revision and overrides", nextRequestId());
    const overrides = parseOverrides(body.overrides, false); if (!overrides) return fail(reply, 422, "invalid_overrides", "Overrides contain unsupported fields or values", nextRequestId());
    const normalized = { expectedRevision: body.expectedRevision as number, overrides };
    const result = await dependencies.repository.replacePreferences({ context, ...normalized, idempotencyKey: key, requestFingerprint: fingerprint("replace-preferences", normalized) });
    if (!result.ok) return repositoryFailure(reply, result, nextRequestId()); return result.value;
  });
  app.post("/v1/storefront/global-change-proposals", async (request, reply) => {
    privateResponse(reply); const context = await requireBuyer(request, reply); if (!context) return reply;
    const key = idempotencyKey(request); const body = request.body;
    if (!key) return fail(reply, 400, "invalid_idempotency_key", "Idempotency-Key must be a UUID", nextRequestId());
    if (!isObject(body) || !hasOnly(body, ["baseGlobalRevision", "proposed"]) || !Number.isSafeInteger(body.baseGlobalRevision) || (body.baseGlobalRevision as number) < 0) return fail(reply, 422, "invalid_proposal", "Expected a non-negative global revision and complete proposed values", nextRequestId());
    const proposed = parseOverrides(body.proposed, true); if (!proposed) return fail(reply, 422, "invalid_proposed_preferences", "A proposal must contain exactly the three finite preference values", nextRequestId());
    const normalized = { baseGlobalRevision: body.baseGlobalRevision as number, proposed: proposed as Required<StorefrontOverrides> };
    const result = await dependencies.repository.createProposal({ context, ...normalized, idempotencyKey: key, requestFingerprint: fingerprint("create-proposal", normalized) });
    if (!result.ok) return repositoryFailure(reply, result, nextRequestId()); return reply.code(201).send(publicProposal(result.value));
  });
  app.get<{ Params: { id: string } }>("/v1/storefront/global-change-proposals/:id", async (request, reply) => {
    privateResponse(reply); const context = await requireBuyer(request, reply); if (!context) return reply;
    const result = await dependencies.repository.getBuyerProposal(context, request.params.id); if (!result.ok) return repositoryFailure(reply, result, nextRequestId()); return publicProposal(result.value);
  });
  app.get("/v1/storefront/admin/global-change-proposals", async (request, reply) => {
    privateResponse(reply); const context = await requireAdmin(request, reply); if (!context) return reply; return { proposals: await dependencies.repository.listAdminProposals(context) };
  });
  app.get<{ Params: { id: string } }>("/v1/storefront/admin/global-change-proposals/:id", async (request, reply) => {
    privateResponse(reply); const context = await requireAdmin(request, reply); if (!context) return reply;
    const result = await dependencies.repository.getAdminProposal(context, request.params.id); if (!result.ok) return repositoryFailure(reply, result, nextRequestId()); return result.value;
  });
  app.post<{ Params: { id: string } }>("/v1/storefront/admin/global-change-proposals/:id/approve", async (request, reply) => {
    privateResponse(reply); const context = await requireAdmin(request, reply); if (!context) return reply;
    const key = idempotencyKey(request); const body = request.body; if (!key) return fail(reply, 400, "invalid_idempotency_key", "Idempotency-Key must be a UUID", nextRequestId());
    if (!isObject(body) || !hasOnly(body, ["expectedProposalRevision", "expectedGlobalRevision"]) || !Number.isSafeInteger(body.expectedProposalRevision) || !Number.isSafeInteger(body.expectedGlobalRevision)) return fail(reply, 422, "invalid_approval", "Expected exact proposal and global revisions", nextRequestId());
    const normalized = { proposalId: request.params.id, expectedProposalRevision: body.expectedProposalRevision as number, expectedGlobalRevision: body.expectedGlobalRevision as number };
    const result = await dependencies.repository.approveProposal({ context, ...normalized, idempotencyKey: key, requestFingerprint: fingerprint("approve-proposal", normalized) });
    if (!result.ok) return repositoryFailure(reply, result, nextRequestId()); return result.value;
  });
  app.post<{ Params: { id: string } }>("/v1/storefront/admin/global-change-proposals/:id/reject", async (request, reply) => {
    privateResponse(reply); const context = await requireAdmin(request, reply); if (!context) return reply;
    const key = idempotencyKey(request); const body = request.body; if (!key) return fail(reply, 400, "invalid_idempotency_key", "Idempotency-Key must be a UUID", nextRequestId());
    if (!isObject(body) || !hasOnly(body, ["expectedProposalRevision"]) || !Number.isSafeInteger(body.expectedProposalRevision)) return fail(reply, 422, "invalid_rejection", "Expected an exact proposal revision", nextRequestId());
    const normalized = { proposalId: request.params.id, expectedProposalRevision: body.expectedProposalRevision as number };
    const result = await dependencies.repository.rejectProposal({ context, ...normalized, idempotencyKey: key, requestFingerprint: fingerprint("reject-proposal", normalized) });
    if (!result.ok) return repositoryFailure(reply, result, nextRequestId()); return result.value;
  });
}
