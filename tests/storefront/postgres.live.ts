import Fastify, { type FastifyRequest } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresStorefrontRepository } from "../../apps/service/src/storefront/postgres-repository.js";
import { registerStorefrontRoutes } from "../../apps/service/src/storefront/routes.js";
import type { BuyerContext, StorefrontAdminContext } from "../../apps/service/src/storefront/types.js";

const connectionString = process.env.STOREFRONT_DATABASE_URL;
if (!connectionString) throw new Error("BLOCKED: STOREFRONT_DATABASE_URL is required for the explicit PostgreSQL live gate");

const { Pool } = pg;
const pool = new Pool({ connectionString, max: 8 });
const future = "2099-01-01T00:00:00.000Z";
const buyer = (tenantId: string, buyerId: string): BuyerContext => ({ kind: "buyer", tenantId, buyerId, hostSessionId: `host-${buyerId}`, policyVersion: "p1", expiresAt: future });
const admin = (tenantId: string): StorefrontAdminContext => ({ kind: "staff", tenantId, actorId: "same-id", role: "admin", policyVersion: "p1", expiresAt: future });

describe("storefront HTTP -> PostgreSQL repository -> forced RLS", () => {
  const repository = new PostgresStorefrontRepository(pool);
  const app = Fastify();
  const identities = new Map<string, BuyerContext | StorefrontAdminContext>([
    ["atlas-a", buyer("atlas", "same-id")], ["atlas-b", buyer("atlas", "buyer-b")], ["boreal-a", buyer("boreal", "same-id")], ["admin-atlas", admin("atlas")],
  ]);
  const headers = (token: string, key?: string) => ({ authorization: `Bearer ${token}`, ...(key ? { "idempotency-key": key } : {}) });

  beforeAll(async () => {
    const resolve = (request: FastifyRequest) => identities.get(String(request.headers.authorization).replace("Bearer ", ""));
    await registerStorefrontRoutes(app, { repository, authenticateBuyer: async (request) => { const value = resolve(request); return value?.kind === "buyer" ? value : null; }, authenticateAdmin: async (request) => { const value = resolve(request); return value?.kind === "staff" ? value : null; } });
  });
  afterAll(async () => { await app.close(); await pool.end(); });

  it("persists only the owning buyer and keeps identical buyer/staff IDs authority-separated", async () => {
    const saved = await app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("atlas-a", crypto.randomUUID()), payload: { expectedRevision: 0, overrides: { theme: "light" } } });
    expect(saved.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: headers("atlas-b") })).json().overrides).toEqual({});
    expect((await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: headers("boreal-a") })).json().overrides).toEqual({});
    expect((await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: headers("admin-atlas") })).statusCode).toBe(401);
  });

  it("serializes concurrent CAS and body-bound idempotency", async () => {
    const attempts = await Promise.all([
      app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("atlas-b", crypto.randomUUID()), payload: { expectedRevision: 0, overrides: { density: "compact" } } }),
      app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("atlas-b", crypto.randomUUID()), payload: { expectedRevision: 0, overrides: { productLayout: "list" } } }),
    ]);
    expect(attempts.map((item) => item.statusCode).sort()).toEqual([200, 409]);
    const key = crypto.randomUUID();
    const first = await app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("boreal-a", key), payload: { expectedRevision: 0, overrides: { theme: "dark" } } });
    const replay = await app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("boreal-a", key), payload: { overrides: { theme: "dark" }, expectedRevision: 0 } });
    expect(first.statusCode).toBe(200); expect(replay.json()).toEqual(first.json());
    expect((await app.inject({ method: "PUT", url: "/v1/storefront/me/preferences", headers: headers("boreal-a", key), payload: { expectedRevision: 1, overrides: {} } })).statusCode).toBe(409);
  });

  it("keeps proposal inert, hides it cross-buyer, and approval preserves personal overrides", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/storefront/global-change-proposals", headers: headers("atlas-a", crypto.randomUUID()), payload: { baseGlobalRevision: 0, proposed: { theme: "dark", density: "compact", productLayout: "list" } } });
    expect(created.statusCode).toBe(201); const id = created.json().id;
    expect((await app.inject({ method: "GET", url: `/v1/storefront/global-change-proposals/${id}`, headers: headers("atlas-b") })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: headers("atlas-a") })).json().effective.theme).toBe("light");
    const approved = await app.inject({ method: "POST", url: `/v1/storefront/admin/global-change-proposals/${id}/approve`, headers: headers("admin-atlas", crypto.randomUUID()), payload: { expectedProposalRevision: 1, expectedGlobalRevision: 0 } });
    expect(approved.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/storefront/me/preferences", headers: headers("atlas-a") })).json().effective).toEqual({ theme: "light", density: "compact", productLayout: "list" });
  });

  it("enforces SQL constraints, RLS, and non-PUBLIC quota functions under the nonowner role", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id','atlas',true),set_config('app.storefront_buyer_id','buyer-b',true),set_config('app.storefront_staff_actor_id','',true)");
      const hidden = await client.query("SELECT id FROM storage.storefront_global_proposals");
      expect(hidden.rowCount).toBe(0);
      await expect(client.query(`INSERT INTO storage.storefront_buyer_preferences(tenant_id,buyer_id,overrides,buyer_revision) VALUES('atlas','buyer-b','{"theme":null}',9)`)).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
      const privilege = await client.query("SELECT has_function_privilege('public','storage.storefront_admit_pending(text,text)','EXECUTE') AS allowed");
      expect(privilege.rows[0].allowed).toBe(false);
    } finally { if (!client.released) client.release(); }
  });

  it("enforces the tenant-wide pending quota independently of buyer-visible RLS rows", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let buyerIndex = 0; buyerIndex < 20; buyerIndex++) {
        const buyerId = `quota-${buyerIndex}`;
        await client.query("SELECT set_config('app.tenant_id','atlas',true),set_config('app.storefront_buyer_id',$1,true),set_config('app.storefront_staff_actor_id','',true)", [buyerId]);
        for (let count = 0; count < 5; count++) await client.query("SELECT storage.storefront_admit_pending('atlas',$1)", [buyerId]);
      }
      await client.query("COMMIT");
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id','atlas',true),set_config('app.storefront_buyer_id','quota-overflow',true),set_config('app.storefront_staff_actor_id','',true)");
      await expect(client.query("SELECT storage.storefront_admit_pending('atlas','quota-overflow')")).rejects.toMatchObject({ code: "P0001", message: "storefront_tenant_pending_quota" });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id','boreal',true),set_config('app.storefront_buyer_id','quota-independent',true),set_config('app.storefront_staff_actor_id','',true)");
      await expect(client.query("SELECT storage.storefront_admit_pending('boreal','quota-independent')")).resolves.toBeDefined();
      await client.query("ROLLBACK");
    } finally { client.release(); }
  });
});
