import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildApi } from "../../apps/service/src/api/server.js";
import type { ApiOperations } from "../../apps/service/src/api/ports.js";
import { SessionManager } from "../../apps/service/src/api/session.js";
import type { ServiceConfig } from "../../apps/service/src/config.js";
import type { BackendSnapshot } from "../../apps/service/src/evals/backend-oracle.js";
import { createFastifyAttackHarness } from "../../apps/service/src/evals/fastify-harness.js";

const config: ServiceConfig = { databaseUrl: "postgres://unused", host: "127.0.0.1", port: 4100, publicOriginAllowlist: ["http://localhost:9001"], sessionAudience: "changedesk", sessionIssuerAllowlist: ["atlas"], sessionTtlSeconds: 300, bridgeTicketMaxTtlSeconds: 60, bodyLimitBytes: 65_536, workerId: "security-test", workerLeaseSeconds: 30, workerGlobalCap: 8, hosts: [] };
const emptySnapshot = (): BackendSnapshot => ({ tenants: { atlas: { products: {} }, boreal: { products: {} } }, outboundDestinations: [] });
const authHeaders = (origin = "http://localhost:9001") => ({ authorization: `Bearer ${"x".repeat(43)}`, origin, "idempotency-key": "123e4567-e89b-42d3-a456-426614174000" });
const request = { message: "prepare allowed products", selectedProductIds: [], clientRequestId: "123e4567-e89b-42d3-a456-426614174000" };

function mockSessions(roles: string[]) { return { authenticate: vi.fn().mockResolvedValue({ tenantId: "atlas", actorId: "atlas.viewer", hostSessionId: "host", roles, policyVersion: "p1", expiresAt: "2099-01-01T00:00:00Z" }), exchange: vi.fn() } as any; }
function mockOperations() { return new Proxy({}, { get(target, property) { if (!(property in target)) Object.assign(target, { [property]: vi.fn().mockResolvedValue({}) }); return (target as any)[property]; } }) as ApiOperations & Record<string, ReturnType<typeof vi.fn>>; }

describe("actual Change Desk Fastify adversarial requests with mock-labelled ports", () => {
  it.each([
    ["ATK-002 role spoofing", { ...request, role: "admin" }, authHeaders(), 422],
    ["ATK-007 tenant claim tamper", { ...request, tenantId: "boreal" }, authHeaders(), 422],
    ["ATK-017 record bound", { ...request, selectedProductIds: Array.from({ length: 101 }, (_, i) => `p${i}`) }, authHeaders(), 422],
    ["ATK-024 cross-origin mutation", request, authHeaders("https://evil.example.test"), 403],
  ])("%s is rejected before an operation and produces no backend effect", async (_name, payload, headers, statusCode) => {
    const operations = mockOperations();
    const app = buildApi({ config, sessions: mockSessions(["viewer"]), operations });
    const harness = createFastifyAttackHarness(app, async () => emptySnapshot());
    const result = await harness.attack({ method: "POST", url: "/v1/requests", headers, payload }, { tenantId: "atlas", allowedAssociationAdds: [] });
    expect(result.response.statusCode).toBe(statusCode);
    expect(result.oracle).toMatchObject({ passed: true, violations: [] });
    expect(operations.createRequest).not.toHaveBeenCalled();
    await app.close();
  });

  it("ATK-006 rejects a correctly signed ticket for the wrong audience before replay consumption", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const now = Math.floor(Date.now() / 1000);
    const claims = { v: 1, typ: "changedesk.bootstrap", iss: "atlas", aud: "wrong-audience", sub: "atlas.operator", tenantId: "atlas", hostSessionId: "h", policyVersion: "p1", origin: "http://localhost:9001", jti: "j1", iat: now, exp: now + 30 };
    const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const ticket = `${encoded}.${sign(null, Buffer.from(encoded, "base64url"), privateKey).toString("base64url")}`;
    const consumeTicket = vi.fn().mockResolvedValue(true);
    const sessions = new SessionManager({ consumeTicket }, { publicKey: vi.fn().mockResolvedValue(publicKey), reauthorize: vi.fn() }, { audience: "changedesk", issuers: ["atlas"], origins: ["http://localhost:9001"], ticketMaxTtlSeconds: 60, sessionTtlSeconds: 300 });
    const app = buildApi({ config, sessions, operations: mockOperations() });
    const harness = createFastifyAttackHarness(app, async () => emptySnapshot());
    const result = await harness.attack({ method: "POST", url: "/v1/session/exchange", headers: { origin: "http://localhost:9001", "idempotency-key": "123e4567-e89b-42d3-a456-426614174000" }, payload: { ticket } }, { tenantId: "atlas", allowedAssociationAdds: [] });
    expect(result.response.statusCode).toBe(401);
    expect(result.oracle.passed).toBe(true);
    expect(consumeTicket).not.toHaveBeenCalled();
    await app.close();
  });
});
