import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { buildApi } from "../../apps/service/src/api/server.js";
import { ApiError } from "../../apps/service/src/api/errors.js";
import { BuyerSessionManager, type StorefrontBootstrapClaims } from "../../apps/service/src/storefront/session.js";

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

  it("returns a controlled Retry-After when the real buyer session manager reaches capacity", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const now = new Date("2026-10-24T12:00:00.000Z");
    const ticket = (sequence: number) => {
      const claims: StorefrontBootstrapClaims = { v: 1, typ: "changedesk.storefront.bootstrap", iss: "atlas-host", aud: "staff:storefront", sub: `buyer-${sequence}`, tenantId: "atlas", hostSessionId: `host-${sequence}`, policyVersion: "p1", origin: "https://atlas.test", jti: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`, iat: Math.floor(now.getTime() / 1000), exp: Math.floor(now.getTime() / 1000) + 60 };
      const payload = Buffer.from(JSON.stringify(claims));
      return `${payload.toString("base64url")}.${sign(null, payload, privateKey).toString("base64url")}`;
    };
    const buyerSessions = new BuyerSessionManager(
      { consumeTicket: async () => true },
      { publicKey: async () => publicKey, reauthorizeBuyer: async () => ({ active: true, policyVersion: "p1" }) },
      { audience: "staff:storefront", issuers: ["atlas-host"], origins: ["https://atlas.test"], ticketMaxTtlSeconds: 60, sessionTtlSeconds: 300, maxSessions: 1, clock: () => now },
    );
    const repository = { getPreferences: vi.fn(), listAdminProposals: vi.fn(async () => []) };
    const app = buildApi({ config, sessions: { authenticate: vi.fn() } as never, operations: {} as never, storefront: { repository: repository as never, buyerSessions } });
    const exchange = (sequence: number) => app.inject({ method: "POST", url: "/v1/storefront/session/exchange", headers: { origin: "https://atlas.test", "idempotency-key": `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}` }, payload: { ticket: ticket(sequence) } });
    expect((await exchange(1)).statusCode).toBe(200);
    const exhausted = await exchange(2);
    expect(exhausted.statusCode).toBe(429);
    expect(exhausted.headers["retry-after"]).toBe("60");
    expect(exhausted.json()).toMatchObject({ error: { code: "session_capacity", retryable: true } });
  });
});
