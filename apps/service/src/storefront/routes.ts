import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { BuyerContext, RepositoryResult, StorefrontAdminContext, StorefrontOverrides, StorefrontProposal, StorefrontRepository } from "./types.js";
import type { BuyerSessionManager } from "./session.js";

export interface StorefrontRouteDependencies {
  readonly repository: StorefrontRepository;
  readonly authenticateBuyer: (request: FastifyRequest) => Promise<BuyerContext | null>;
  readonly authenticateAdmin: (request: FastifyRequest) => Promise<StorefrontAdminContext | null>;
  readonly buyerSessions?: BuyerSessionManager;
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
  return {
    ...(typeof value.theme === "string" ? { theme: value.theme as "light" | "dark" | "system" } : {}),
    ...(typeof value.density === "string" ? { density: value.density as "comfortable" | "compact" } : {}),
    ...(typeof value.productLayout === "string" ? { productLayout: value.productLayout as "grid" | "list" } : {}),
  };
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
  const routeErrorHandler = (error: Error & { statusCode?: number }, _request: FastifyRequest, reply: FastifyReply) => {
    const tooLarge = error.statusCode === 413;
    const controlled = typeof error.statusCode === "number" && "code" in error;
    return fail(reply, tooLarge ? 413 : controlled ? error.statusCode! : 503, tooLarge ? "body_too_large" : controlled ? String((error as {code:unknown}).code).toLowerCase() : "storefront_unavailable", tooLarge ? "Request body exceeds 64 KiB" : controlled ? error.message : "Storefront dependency unavailable", nextRequestId(), controlled ? Boolean((error as {retryable?:unknown}).retryable) : !tooLarge);
  };
  const readOptions = { errorHandler: routeErrorHandler };
  const mutationOptions = { bodyLimit: 65_536, errorHandler: routeErrorHandler };
  async function requireBuyer(request: FastifyRequest, reply: FastifyReply): Promise<BuyerContext | null> {
    const context = await dependencies.authenticateBuyer(request);
    const expiry = context ? Date.parse(context.expiresAt) : Number.NaN;
    if (!context || context.kind !== "buyer" || !context.tenantId || !context.buyerId || !context.hostSessionId || !context.policyVersion || !Number.isFinite(expiry) || expiry <= (dependencies.now?.() ?? new Date()).getTime()) { fail(reply, 401, "buyer_session_required", "A current buyer session is required", nextRequestId()); return null; }
    return context;
  }

  const buyerSessions = dependencies.buyerSessions;
  if (buyerSessions) app.post("/v1/storefront/session/exchange", mutationOptions, async (request, reply) => {
    privateResponse(reply); const key = idempotencyKey(request); const body = request.body; const origin = request.headers.origin;
    if (!key) return fail(reply, 400, "invalid_idempotency_key", "Idempotency-Key must be a UUID", nextRequestId());
    if (!origin) return fail(reply, 403, "origin_required", "Exact Origin is required", nextRequestId());
    if (!isObject(body) || !hasOnly(body, ["ticket"]) || typeof body.ticket !== "string" || body.ticket.length > 8_192) return fail(reply, 422, "invalid_ticket", "A signed storefront ticket is required", nextRequestId());
    return buyerSessions.exchange(body.ticket, origin);
  });
  async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<StorefrontAdminContext | null> {
    const context = await dependencies.authenticateAdmin(request);
    const expiry = context ? Date.parse(context.expiresAt) : Number.NaN;
    if (!context || context.kind !== "staff" || !context.tenantId || !context.actorId || !context.policyVersion || !Number.isFinite(expiry) || expiry <= (dependencies.now?.() ?? new Date()).getTime()) { fail(reply, 401, "staff_session_required", "A current staff session is required", nextRequestId()); return null; }
    if (context.role !== "admin") { fail(reply, 403, "admin_required", "Administrator authority is required", nextRequestId()); return null; }
    return context;
  }

  app.get("/v1/storefront/me/preferences", readOptions, async (request, reply) => {
    privateResponse(reply); const context = await requireBuyer(request, reply); if (!context) return reply;
    return dependencies.repository.getPreferences(context);
  });
  app.put("/v1/storefront/me/preferences", mutationOptions, async (request, reply) => {
    privateResponse(reply); const context = await requireBuyer(request, reply); if (!context) return reply;
    const key = idempotencyKey(request); const body = request.body;
    if (!key) return fail(reply, 400, "invalid_idempotency_key", "Idempotency-Key must be a UUID", nextRequestId());
    if (!isObject(body) || !hasOnly(body, ["expectedRevision", "overrides"]) || !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) return fail(reply, 422, "invalid_preferences", "Expected a non-negative revision and overrides", nextRequestId());
    const overrides = parseOverrides(body.overrides, false); if (!overrides) return fail(reply, 422, "invalid_overrides", "Overrides contain unsupported fields or values", nextRequestId());
    const normalized = { expectedRevision: body.expectedRevision as number, overrides };
    const result = await dependencies.repository.replacePreferences({ context, ...normalized, idempotencyKey: key, requestFingerprint: fingerprint("replace-preferences", normalized) });
    if (!result.ok) return repositoryFailure(reply, result, nextRequestId()); return result.value;
  });
  app.post("/v1/storefront/global-change-proposals", mutationOptions, async (request, reply) => {
    privateResponse(reply); const context = await requireBuyer(request, reply); if (!context) return reply;
    const key = idempotencyKey(request); const body = request.body;
    if (!key) return fail(reply, 400, "invalid_idempotency_key", "Idempotency-Key must be a UUID", nextRequestId());
    if (!isObject(body) || !hasOnly(body, ["baseGlobalRevision", "proposed"]) || !Number.isSafeInteger(body.baseGlobalRevision) || (body.baseGlobalRevision as number) < 0) return fail(reply, 422, "invalid_proposal", "Expected a non-negative global revision and complete proposed values", nextRequestId());
    const proposed = parseOverrides(body.proposed, true); if (!proposed) return fail(reply, 422, "invalid_proposed_preferences", "A proposal must contain exactly the three finite preference values", nextRequestId());
    const normalized = { baseGlobalRevision: body.baseGlobalRevision as number, proposed: proposed as Required<StorefrontOverrides> };
    const result = await dependencies.repository.createProposal({ context, ...normalized, idempotencyKey: key, requestFingerprint: fingerprint("create-proposal", normalized) });
    if (!result.ok) return repositoryFailure(reply, result, nextRequestId()); return reply.code(201).send(publicProposal(result.value));
  });
  app.get<{ Params: { id: string } }>("/v1/storefront/global-change-proposals/:id", readOptions, async (request, reply) => {
    privateResponse(reply); const context = await requireBuyer(request, reply); if (!context) return reply;
    const result = await dependencies.repository.getBuyerProposal(context, request.params.id); if (!result.ok) return repositoryFailure(reply, result, nextRequestId()); return publicProposal(result.value);
  });
  app.get("/v1/storefront/admin/global-change-proposals", readOptions, async (request, reply) => {
    privateResponse(reply); const context = await requireAdmin(request, reply); if (!context) return reply; return { proposals: await dependencies.repository.listAdminProposals(context) };
  });
  app.get<{ Params: { id: string } }>("/v1/storefront/admin/global-change-proposals/:id", readOptions, async (request, reply) => {
    privateResponse(reply); const context = await requireAdmin(request, reply); if (!context) return reply;
    const result = await dependencies.repository.getAdminProposal(context, request.params.id); if (!result.ok) return repositoryFailure(reply, result, nextRequestId()); return result.value;
  });
  app.post<{ Params: { id: string } }>("/v1/storefront/admin/global-change-proposals/:id/approve", mutationOptions, async (request, reply) => {
    privateResponse(reply); const context = await requireAdmin(request, reply); if (!context) return reply;
    const key = idempotencyKey(request); const body = request.body; if (!key) return fail(reply, 400, "invalid_idempotency_key", "Idempotency-Key must be a UUID", nextRequestId());
    if (!isObject(body) || !hasOnly(body, ["expectedProposalRevision", "expectedGlobalRevision"]) || !Number.isSafeInteger(body.expectedProposalRevision) || !Number.isSafeInteger(body.expectedGlobalRevision)) return fail(reply, 422, "invalid_approval", "Expected exact proposal and global revisions", nextRequestId());
    const normalized = { proposalId: request.params.id, expectedProposalRevision: body.expectedProposalRevision as number, expectedGlobalRevision: body.expectedGlobalRevision as number };
    const result = await dependencies.repository.approveProposal({ context, ...normalized, idempotencyKey: key, requestFingerprint: fingerprint("approve-proposal", normalized) });
    if (!result.ok) return repositoryFailure(reply, result, nextRequestId()); return result.value;
  });
  app.post<{ Params: { id: string } }>("/v1/storefront/admin/global-change-proposals/:id/reject", mutationOptions, async (request, reply) => {
    privateResponse(reply); const context = await requireAdmin(request, reply); if (!context) return reply;
    const key = idempotencyKey(request); const body = request.body; if (!key) return fail(reply, 400, "invalid_idempotency_key", "Idempotency-Key must be a UUID", nextRequestId());
    if (!isObject(body) || !hasOnly(body, ["expectedProposalRevision"]) || !Number.isSafeInteger(body.expectedProposalRevision)) return fail(reply, 422, "invalid_rejection", "Expected an exact proposal revision", nextRequestId());
    const normalized = { proposalId: request.params.id, expectedProposalRevision: body.expectedProposalRevision as number };
    const result = await dependencies.repository.rejectProposal({ context, ...normalized, idempotencyKey: key, requestFingerprint: fingerprint("reject-proposal", normalized) });
    if (!result.ok) return repositoryFailure(reply, result, nextRequestId()); return result.value;
  });
}
