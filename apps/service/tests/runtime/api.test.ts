import { describe, expect, it, vi } from "vitest";
import { buildApi } from "../../src/api/server.js";
import type { ServiceConfig } from "../../src/config.js";

const config: ServiceConfig = { apiDatabaseUrl: "postgres://invalid-api", workerDatabaseUrl: "postgres://invalid-worker", host: "127.0.0.1", port: 4100, publicOriginAllowlist: ["http://localhost:9001"], sessionAudience: "changedesk", sessionIssuerAllowlist: ["atlas"], sessionTtlSeconds: 300, bridgeTicketMaxTtlSeconds: 60, bodyLimitBytes: 65_536, workerId: "w", workerLeaseSeconds: 30, workerGlobalCap: 8, hosts: [], publicationKeyId: "key", publicationPrivateKeyPem: "pem" };

describe("REST authorization and validation", () => {
  it("ACC-003 rejects viewer mutations even with a known endpoint", async () => {
    const operations = fakeOperations();
    const app = buildApi({ config, sessions: sessions(["viewer"]), operations: operations as any });
    const response = await app.inject({ method: "POST", url: "/v1/requests", headers: headers(), payload: { message: "do it", selectedProductIds: [], clientRequestId: "123e4567-e89b-42d3-a456-426614174000" } });
    expect(response.statusCode).toBe(403);
    expect(operations.createRequest).not.toHaveBeenCalled();
  });

  it("SEC-TENANT rejects tenant authority fields as unknown input", async () => {
    const operations = fakeOperations();
    const app = buildApi({ config, sessions: sessions(["operator"]), operations: operations as any });
    const response = await app.inject({ method: "POST", url: "/v1/requests", headers: headers(), payload: { message: "do it", selectedProductIds: [], clientRequestId: "123e4567-e89b-42d3-a456-426614174000", tenantId: "boreal" } });
    expect(response.statusCode).toBe(422);
    expect(operations.createRequest).not.toHaveBeenCalled();
  });

  it("ACC-006 rejects approval when body and header idempotency keys differ before storage", async () => {
    const operations = fakeOperations();
    const app = buildApi({ config, sessions: sessions(["operator"]), operations: operations as any });
    const response = await app.inject({ method: "POST", url: "/v1/approvals", headers: headers(), payload: { planId: "p", planHash: "a".repeat(64), expectedPlanVersion: 1, idempotencyKey: "123e4567-e89b-42d3-a456-426614174001" } });
    expect(response.statusCode).toBe(400);
    expect(operations.createApproval).not.toHaveBeenCalled();
  });
});

function sessions(roles: string[]) { return { authenticate: vi.fn().mockResolvedValue({ tenantId: "atlas", actorId: "u", hostSessionId: "h", roles, policyVersion: "p", expiresAt: "2099-01-01T00:00:00Z" }), exchange: vi.fn() } as any; }
function headers() { return { authorization: `Bearer ${"x".repeat(43)}`, origin: "http://localhost:9001", "idempotency-key": "123e4567-e89b-42d3-a456-426614174000" }; }
function fakeOperations() { return new Proxy({}, { get(target, property) { if (!(property in target)) Object.assign(target, { [property]: vi.fn().mockResolvedValue({}) }); return (target as any)[property]; } }) as Record<string, ReturnType<typeof vi.fn>>; }
