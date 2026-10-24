import { describe, expect, it, vi } from "vitest";
import { StorefrontSessionRegistry, type ExpressSessionStoreLike } from "../../packages/medusa-plugin/src/storefront/session-registry.js";

vi.mock("../../packages/medusa-plugin/src/bridge/crypto.ts", () => ({ importPrivateKey: () => ({}) }));
vi.mock("../../packages/medusa-plugin/src/storefront/ticket.ts", () => ({ issueStorefrontBootstrapTicket: () => ({ ticket: "signed-fixture", claims: { exp: 1_798_800_060 } }) }));
vi.mock("../../packages/medusa-plugin/src/modules/changedesk/index.ts", () => ({ CHANGEDESK_MODULE: "changedesk" }));

describe("Medusa cookie-session lifecycle registry", () => {
  it("rejects non-positive and non-finite registry capacities", () => {
    for (const capacity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new StorefrontSessionRegistry(capacity)).toThrow(RangeError);
    }
  });

  it("keeps raw session IDs in host memory and fails after native store destruction", async () => {
    const sessions = new Map<string, unknown>([["raw-secret-sid", { auth_context: { actor_type: "customer", actor_id: "buyer-1" } }]]);
    const store: ExpressSessionStoreLike = { get: (id, callback) => callback(null, sessions.get(id)) };
    const registry = new StorefrontSessionRegistry();
    const reference = registry.register({ tenantId: "atlas", buyerId: "buyer-1", rawSessionId: "raw-secret-sid", expiresAt: 1_798_800_300_000 });
    expect(reference).not.toContain("raw-secret-sid");
    expect(await registry.authorize({ tenantId: "atlas", buyerId: "buyer-1", hostSessionId: reference, store, now: 1_798_800_000_000 })).toBe(true);
    sessions.delete("raw-secret-sid");
    expect(await registry.authorize({ tenantId: "atlas", buyerId: "buyer-1", hostSessionId: reference, store, now: 1_798_800_001_000 })).toBe(false);
  });

  it("fails closed for cross-buyer, expiry, and process restart", async () => {
    const store: ExpressSessionStoreLike = { get: (_id, callback) => callback(null, { auth_context: { actor_type: "customer", actor_id: "buyer-1" } }) };
    const registry = new StorefrontSessionRegistry();
    const reference = registry.register({ tenantId: "atlas", buyerId: "buyer-1", rawSessionId: "raw", expiresAt: 1000 });
    expect(await registry.authorize({ tenantId: "atlas", buyerId: "buyer-2", hostSessionId: reference, store, now: 500 })).toBe(false);
    expect(await registry.authorize({ tenantId: "atlas", buyerId: "buyer-1", hostSessionId: reference, store, now: 1001 })).toBe(false);
    expect(await new StorefrontSessionRegistry().authorize({ tenantId: "atlas", buyerId: "buyer-1", hostSessionId: reference, store, now: 500 })).toBe(false);
  });

  it("fails closed on an expired native cookie or a session store that never responds", async () => {
    const expired: ExpressSessionStoreLike = { get: (_id, callback) => callback(null, { auth_context: { actor_type: "customer", actor_id: "buyer-1" }, cookie: { expires: "2026-01-01T00:00:00.000Z" } }) };
    const registry = new StorefrontSessionRegistry(10, () => "reference", 10);
    const reference = registry.register({ tenantId: "atlas", buyerId: "buyer-1", rawSessionId: "raw", expiresAt: 1_798_800_300_000 });
    expect(await registry.authorize({ tenantId: "atlas", buyerId: "buyer-1", hostSessionId: reference, store: expired, now: 1_798_800_000_000 })).toBe(false);
    const second = registry.register({ tenantId: "atlas", buyerId: "buyer-1", rawSessionId: "raw-2", expiresAt: 1_798_800_300_000 });
    const never: ExpressSessionStoreLike = { get: () => undefined };
    await expect(registry.authorize({ tenantId: "atlas", buyerId: "buyer-1", hostSessionId: second, store: never, now: 1_798_800_000_000 })).resolves.toBe(false);
  });

  it("never evicts a live customer mapping and reuses the same exact host session under concurrent registration", async () => {
    let sequence = 0;
    const registry = new StorefrontSessionRegistry(1, () => `reference-${++sequence}`);
    const input = { tenantId: "atlas", buyerId: "buyer-1", rawSessionId: "raw-a", expiresAt: Date.now() + 60_000 };
    const references = await Promise.all(Array.from({ length: 8 }, async () => registry.register(input)));
    expect(new Set(references)).toEqual(new Set(["sf_reference-1"]));
    expect(() => registry.register({ tenantId: "atlas", buyerId: "buyer-2", rawSessionId: "raw-b", expiresAt: Date.now() + 60_000 })).toThrowError(expect.objectContaining({ status: 429, code: "storefront_session_capacity" }));
    const store: ExpressSessionStoreLike = { get: (_id, callback) => callback(null, { auth_context: { actor_type: "customer", actor_id: "buyer-1" } }) };
    await expect(registry.authorize({ tenantId: "atlas", buyerId: "buyer-1", hostSessionId: references[0]!, store })).resolves.toBe(true);
  });

  it("reclaims an expired mapping before admitting a different customer", () => {
    let sequence = 0;
    const registry = new StorefrontSessionRegistry(1, () => `reference-${++sequence}`);
    registry.register({ tenantId: "atlas", buyerId: "buyer-1", rawSessionId: "raw-a", expiresAt: Date.now() - 1 });
    expect(registry.register({ tenantId: "atlas", buyerId: "buyer-2", rawSessionId: "raw-b", expiresAt: Date.now() + 60_000 })).toBe("sf_reference-2");
  });

  it("returns host 429 with Retry-After instead of invalidating a live customer ticket binding", async () => {
    const { createStorefrontSessionPost } = await import("../../packages/medusa-plugin/src/api/store/customers/me/changedesk/session/route.js");
    const registry = new StorefrontSessionRegistry(1, (() => { let sequence = 0; return () => `route-${++sequence}`; })());
    const post = createStorefrontSessionPost(registry);
    const options = { installationId: "atlas-host", serviceAudience: "changedesk", tenantId: "atlas", allowedOrigins: ["https://atlas.test"], bootstrapPrivateKeyPem: "mocked" };
    const request = (buyerId: string, sessionID: string) => ({ body: {}, headers: { origin: "https://atlas.test", "x-changedesk-csrf": "1" }, auth_context: { actor_type: "customer", actor_id: buyerId }, sessionID, session: { auth_context: { actor_type: "customer", actor_id: buyerId }, cookie: {} }, scope: { resolve: () => ({ getOptions: () => options }) } });
    const response = () => {
      const state: { status?: number; headers: Record<string, string>; body?: unknown } = { headers: {} };
      const res = { setHeader: (name: string, value: string) => { state.headers[name.toLowerCase()] = value; }, status: (status: number) => { state.status = status; return res; }, json: (body: unknown) => { state.body = body; return body; } };
      return { state, res };
    };
    const first = response(); await post(request("buyer-1", "raw-a") as never, first.res as never); expect(first.state.status).toBe(200);
    const second = response(); await post(request("buyer-2", "raw-b") as never, second.res as never);
    expect(second.state.status).toBe(429);
    expect(second.state.headers["retry-after"]).toBe("60");
    expect(second.state.body).toMatchObject({ error: { code: "storefront_session_capacity", retryable: true } });
  });
});
