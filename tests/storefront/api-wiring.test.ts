import { describe, expect, it, vi } from "vitest";
import { buildApi } from "../../apps/service/src/api/server.js";
import { ApiError } from "../../apps/service/src/api/errors.js";

const config = {
  databaseUrl: "postgresql://unused", host: "127.0.0.1", port: 4100,
  publicOriginAllowlist: ["https://atlas.test"], sessionAudience: "staff", sessionIssuerAllowlist: ["atlas"],
  sessionTtlSeconds: 300 as const, bridgeTicketMaxTtlSeconds: 60 as const, bodyLimitBytes: 65_536 as const,
  workerId: "test", workerLeaseSeconds: 30, workerGlobalCap: 8, hosts: [],
};

describe("storefront API wiring", () => {
  it("answers exact-origin preflight for PUT/POST with auth and idempotency headers", async () => {
    const app = buildApi({ config, sessions: { authenticate: vi.fn() } as never, operations: {} as never });
    const allowed = await app.inject({ method: "OPTIONS", url: "/v1/storefront/me/preferences", headers: { origin: "https://atlas.test", "access-control-request-method": "PUT", "access-control-request-headers": "authorization,content-type,idempotency-key" } });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://atlas.test");
    expect(allowed.headers["access-control-allow-methods"]).toContain("PUT");
    expect(allowed.headers["access-control-allow-headers"]?.toLowerCase()).toContain("idempotency-key");
    expect((await app.inject({ method: "OPTIONS", url: "/v1/storefront/me/preferences", headers: { origin: "https://evil.test" } })).statusCode).toBe(403);
  });

  it("registers buyer and admin routes with mutually exclusive session managers", async () => {
    const repository = { getPreferences: vi.fn(async () => ({ overrides: {}, inherited: { theme: "system", density: "comfortable", productLayout: "grid" }, effective: { theme: "system", density: "comfortable", productLayout: "grid" }, buyerRevision: 0, globalRevision: 0 })), listAdminProposals: vi.fn(async () => []) };
    const buyerSessions = { authenticate: vi.fn(async (header?: string) => { if (header !== "Bearer buyer") throw new ApiError(401, "UNAUTHORIZED", "Authentication is required"); return { kind: "buyer", tenantId: "atlas", buyerId: "same-id", hostSessionId: "host", policyVersion: "p1", expiresAt: "2099-01-01T00:00:00.000Z" }; }), exchange: vi.fn() };
    const sessions = { authenticate: vi.fn(async (header?: string) => { if (header !== "Bearer staff") throw new ApiError(401, "UNAUTHORIZED", "Authentication is required"); return { tenantId: "atlas", actorId: "same-id", hostSessionId: "staff-host", roles: ["admin"], policyVersion: "p1", expiresAt: "2099-01-01T00:00:00.000Z" }; }) };
    const app = buildApi({ config, sessions: sessions as never, operations: {} as never, storefront: { repository: repository as never, buyerSessions: buyerSessions as never } });
    expect((await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: { authorization: "Bearer buyer" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: { authorization: "Bearer staff" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/storefront/admin/global-change-proposals", headers: { authorization: "Bearer staff" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/storefront/admin/global-change-proposals", headers: { authorization: "Bearer buyer" } })).statusCode).toBe(401);
  });
});
