import { describe, expect, it } from "vitest";
import { StorefrontSessionRegistry, type ExpressSessionStoreLike } from "../../packages/medusa-plugin/src/storefront/session-registry.js";

describe("Medusa cookie-session lifecycle registry", () => {
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
});
