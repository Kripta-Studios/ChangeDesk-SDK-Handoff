import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { hashCanonical } from "../core/hashing.js";
import type { ActorContext, Role } from "../runtime/types.js";
import type { ServiceConfig } from "../config.js";
import { ApiError, badRequest, forbidden, notFound } from "./errors.js";
import type { ApiOperations, MutationContext } from "./ports.js";
import { paramsId, schemas, createSchemaCompiler } from "./schemas.js";
import type { SessionManager } from "./session.js";

declare module "fastify" { interface FastifyRequest { actor?: ActorContext } }

export function buildApi(options: { config: ServiceConfig; sessions: SessionManager; operations: ApiOperations }): FastifyInstance {
  const app = Fastify({ bodyLimit: options.config.bodyLimitBytes, genReqId: () => randomUUID(), logger: false });
  app.setValidatorCompiler(createSchemaCompiler());
  app.addHook("onSend", async (_request, reply) => { reply.header("cache-control", "no-store"); reply.header("x-content-type-options", "nosniff"); });
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !options.config.publicOriginAllowlist.includes(origin)) throw forbidden();
    if (origin) { reply.header("access-control-allow-origin", origin); reply.header("vary", "Origin"); }
  });
  app.setErrorHandler((error, request, reply) => {
    const validation = typeof error === "object" && error !== null && "validation" in error && (error as { validation?: unknown }).validation;
    const apiError = error instanceof ApiError ? error : validation ? new ApiError(422, "VALIDATION_ERROR", "Request validation failed", false) : new ApiError(500, "INTERNAL_ERROR", "An internal error occurred", false);
    void reply.status(apiError.statusCode).send({ error: { code: apiError.code, message: apiError.message, requestId: request.id, retryable: apiError.retryable, ...(apiError.details === undefined ? {} : { details: apiError.details }) } });
  });

  const authenticate = async (request: FastifyRequest) => { request.actor = await options.sessions.authenticate(request.headers.authorization); };
  const mutate = (roles: readonly Role[], handler: (context: MutationContext, request: FastifyRequest) => Promise<unknown>) => async (request: FastifyRequest, reply: any) => {
    const actor = request.actor!; requireRole(actor, roles);
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw badRequest("INVALID_IDEMPOTENCY_KEY", "A UUID Idempotency-Key header is required");
    const bodyKey = bodyRecord(request).idempotencyKey;
    if (bodyKey !== undefined && bodyKey !== key) throw badRequest("IDEMPOTENCY_KEY_MISMATCH", "Body and header idempotency keys must match");
    const context = { actor, idempotencyKey: key, requestHash: hashCanonical("http-control-request", "1", { method: request.method, route: request.routeOptions.url, body: request.body ?? null }) };
    return reply.send(await handler(context, request));
  };
  const read = (roles: readonly Role[], handler: (actor: ActorContext, request: FastifyRequest) => Promise<unknown | null>) => async (request: FastifyRequest, reply: any) => {
    const actor = request.actor!; requireRole(actor, roles); const result = await handler(actor, request); if (result === null) throw notFound(); return reply.send(result);
  };
  const auth = { preHandler: authenticate };

  app.options("/*", async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin || !options.config.publicOriginAllowlist.includes(origin)) throw forbidden();
    return reply.headers({
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key",
      "access-control-max-age": "300",
    }).status(204).send();
  });
  app.post("/v1/session/exchange", { schema: { body: schemas.sessionExchange } }, async (request, reply) => {
    requireIdempotencyHeader(request);
    const origin = request.headers.origin; if (!origin) throw forbidden();
    return reply.send(await options.sessions.exchange((request.body as { ticket: string }).ticket, origin));
  });
  app.post("/v1/requests", { ...auth, schema: { body: schemas.request } }, mutate(["requester", "operator", "admin"], (c, r) => options.operations.createRequest(c, r.body)));
  app.get("/v1/requests/:id", { ...auth, schema: { params: paramsId } }, read(allRoles, (a, r) => options.operations.getRequest(a, idParam(r))));
  app.post("/v1/requests/:id/messages", { ...auth, schema: { params: paramsId, body: schemas.message } }, mutate(["requester", "operator", "admin"], (c, r) => options.operations.addMessage(c, idParam(r), r.body)));
  app.get("/v1/requests/:id/candidates", { ...auth, schema: { params: paramsId } }, read(["requester", "operator", "admin"], (a, r) => options.operations.getCandidates(a, idParam(r))));
  app.post("/v1/requests/:id/candidate", { ...auth, schema: { params: paramsId, body: schemas.candidate } }, mutate(["requester", "operator", "admin"], (c, r) => options.operations.selectCandidate(c, idParam(r), r.body)));
  app.get("/v1/resources/:kind", { ...auth, schema: { params: schemas.resourceParams, querystring: schemas.resourceQuery } }, read(["requester", "operator", "admin"], (a, r) => options.operations.getResources(a, (r.params as any).kind, r.query as any)));
  app.post("/v1/plans", { ...auth, schema: { body: schemas.plan } }, mutate(["requester", "operator", "admin"], (c, r) => options.operations.createPlan(c, r.body)));
  app.get("/v1/plans/:id", { ...auth, schema: { params: paramsId } }, read(["requester", "operator", "admin"], (a, r) => options.operations.getPlan(a, idParam(r))));
  app.post("/v1/approvals", { ...auth, schema: { body: schemas.approval } }, mutate(["operator", "admin"], (c, r) => options.operations.createApproval(c, r.body)));
  app.post("/v1/executions", { ...auth, schema: { body: schemas.execution } }, mutate(["operator", "admin"], (c, r) => options.operations.startExecution(c, r.body)));
  app.get("/v1/executions/:id", { ...auth, schema: { params: paramsId } }, read(allRoles, (a, r) => options.operations.getExecution(a, idParam(r))));
  app.post("/v1/executions/:id/cancel", { ...auth, schema: { params: paramsId, body: schemas.empty } }, mutate(["operator", "admin"], (c, r) => nullGuard(options.operations.cancelExecution(c, idParam(r)))));
  app.post("/v1/executions/:id/resume", { ...auth, schema: { params: paramsId, body: schemas.empty } }, mutate(["operator", "admin"], (c, r) => nullGuard(options.operations.resumeExecution(c, idParam(r)))));
  app.get("/v1/installations", auth, read(allRoles, (a) => options.operations.getInstallations(a)));
  app.post("/v1/installations", { ...auth, schema: { body: schemas.installation } }, mutate(["admin"], (c, r) => options.operations.createInstallation(c, r.body)));
  app.post("/v1/installations/:id/disable", { ...auth, schema: { params: paramsId, body: schemas.empty } }, mutate(["admin"], (c, r) => nullGuard(options.operations.disableInstallation(c, idParam(r)))));
  app.post("/v1/publications", { ...auth, schema: { body: schemas.publication } }, mutate(["admin"], (c, r) => options.operations.createPublication(c, r.body)));
  app.post("/v1/publications/:id/withdraw", { ...auth, schema: { params: paramsId, body: schemas.empty } }, mutate(["admin"], (c, r) => nullGuard(options.operations.withdrawPublication(c, idParam(r)))));
  app.post("/v1/publications/:id/revoke", { ...auth, schema: { params: paramsId, body: schemas.revoke } }, mutate(["admin"], (c, r) => nullGuard(options.operations.revokePublication(c, idParam(r), r.body))));
  app.get("/v1/evidence/:id", { ...auth, schema: { params: paramsId } }, read(allRoles, (a, r) => options.operations.getEvidence(a, idParam(r))));
  return app;
}

const allRoles: readonly Role[] = ["viewer", "requester", "operator", "admin"];
function requireRole(actor: ActorContext, roles: readonly Role[]) { if (!actor.roles.some((role) => roles.includes(role))) throw forbidden(); }
function requireIdempotencyHeader(request: FastifyRequest) { if (typeof request.headers["idempotency-key"] !== "string") throw badRequest("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key is required"); }
function bodyRecord(request: FastifyRequest): Record<string, unknown> { return request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {}; }
function idParam(request: FastifyRequest): string { return (request.params as { id: string }).id; }
async function nullGuard(value: Promise<unknown | null>) { const result = await value; if (result === null) throw notFound(); return result; }
