import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApi } from "../../apps/service/src/api/server.js";
import { StorageApiOperations } from "../../apps/service/src/api/storage-operations.js";
import type { ServiceConfig } from "../../apps/service/src/config.js";
import { runMigrations } from "../../apps/service/src/storage/migrations.js";
import { Store } from "../../apps/service/src/storage/store.js";

const migratorUrl = process.env.CHANGEDESK_MIGRATOR_DATABASE_URL;
const runtimeUrl = process.env.CHANGEDESK_RUNTIME_DATABASE_URL;
if (!migratorUrl || !runtimeUrl) throw new Error("BLOCKED: real StorageApiOperations security tests require migrator/runtime PostgreSQL references");

const migrator = new Pool({ connectionString: migratorUrl, application_name: "changedesk-security-migrator" });
const runtime = new Pool({ connectionString: runtimeUrl, application_name: "changedesk-security-runtime", max: 2 });
const store = new Store(runtime);
const connector = { readAuthorized: vi.fn(), executeAuthorized: vi.fn(), reconcileOperation: vi.fn() };
const operations = new StorageApiOperations(store, connector as any, {});
const config: ServiceConfig = { databaseUrl: "postgres://external-reference", host: "127.0.0.1", port: 4100, publicOriginAllowlist: ["http://localhost:9001"], sessionAudience: "changedesk", sessionIssuerAllowlist: ["atlas"], sessionTtlSeconds: 300, bridgeTicketMaxTtlSeconds: 60, bodyLimitBytes: 65_536, workerId: "security-test", workerLeaseSeconds: 30, workerGlobalCap: 8, hosts: [] };
const headers = () => ({ authorization: `Bearer ${"x".repeat(43)}`, origin: "http://localhost:9001", "idempotency-key": randomUUID() });

beforeAll(() => runMigrations(migrator, new URL("../../apps/service/migrations/", import.meta.url)));
afterAll(() => Promise.all([runtime.end(), migrator.end()]));

describe("real PostgreSQL StorageApiOperations adversarial acceptance", () => {
  it("ATK-007/SEC-TENANT does not let an admin read another actor's private request", async () => {
    const tenantId = `security-${randomUUID()}`;
    await seedTenant(tenantId, [["operator", "operator"], ["admin", "admin"]]);
    const requestId = randomUUID();
    await store.withTenant({ tenantId, actorId: "operator" }, (tx) => tx.createRequestAndJob({ id: requestId, actorId: "operator", redactedText: "private canary", contextRef: {}, budget: {}, jobId: randomUUID(), idempotencyKey: randomUUID(), requestHash: "a".repeat(64) }));
    const app = buildApi({ config, sessions: sessions(tenantId, "admin", ["admin"]), operations });
    const response = await app.inject({ method: "GET", url: `/v1/requests/${requestId}`, headers: headers() });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("private canary");
    await app.close();
  });

  it("ATK-012 rejects an unknown catalog candidate instead of changing request state", async () => {
    const tenantId = `security-${randomUUID()}`;
    await seedTenant(tenantId, [["operator", "operator"]]);
    const requestId = randomUUID();
    await store.withTenant({ tenantId, actorId: "operator" }, (tx) => tx.createRequestAndJob({ id: requestId, actorId: "operator", redactedText: "reuse", contextRef: {}, budget: {}, jobId: randomUUID(), idempotencyKey: randomUUID(), requestHash: "b".repeat(64) }));
    const app = buildApi({ config, sessions: sessions(tenantId, "operator", ["operator"]), operations });
    const response = await app.inject({ method: "POST", url: `/v1/requests/${requestId}/candidate`, headers: headers(), payload: { candidateId: "nonexistent-private-candidate", version: 99, choice: "reuse" } });
    expect([404, 409, 422]).toContain(response.statusCode);
    const readback = await store.withTenant({ tenantId, actorId: "operator" }, (tx) => tx.getRequest(requestId));
    expect(readback?.state).toBe("received");
    await app.close();
  });

  it("ATK-020 rejects installation of an unvalidated private artifact and leaves no installation", async () => {
    const tenantId = `security-${randomUUID()}`;
    await seedTenant(tenantId, [["admin", "admin"]]);
    const artifactHash = createHash("sha256").update(tenantId).digest("hex");
    await store.withTenant({ tenantId, actorId: "admin" }, (tx) => tx.insertArtifact({ id: randomUUID(), artifactHash, schemaVersion: "malicious-test", canonicalBody: { arbitraryCode: "fixture-data-not-executed" }, idempotencyKey: randomUUID(), requestHash: "c".repeat(64) }));
    const app = buildApi({ config, sessions: sessions(tenantId, "admin", ["admin"]), operations });
    const response = await app.inject({ method: "POST", url: "/v1/installations", headers: headers(), payload: { artifactHash, configuration: {} } });
    expect([409, 422, 503]).toContain(response.statusCode);
    const readback = await store.withTenant({ tenantId, actorId: "admin" }, (tx) => tx.listInstallations());
    expect(readback).toEqual([]);
    await app.close();
  });
});

function sessions(tenantId: string, actorId: string, roles: readonly ("viewer" | "requester" | "operator" | "admin")[]) { return { authenticate: vi.fn().mockResolvedValue({ tenantId, actorId, hostSessionId: "host", roles, policyVersion: "1", expiresAt: "2099-01-01T00:00:00Z" }), exchange: vi.fn() } as any; }
async function seedTenant(tenantId: string, actors: readonly (readonly [string, "viewer" | "requester" | "operator" | "admin"])[]) {
  const client = await migrator.connect();
  try {
    for (const [actorId, role] of actors) {
      await client.query("BEGIN");
      try {
        await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)", [tenantId, actorId]);
        await client.query("INSERT INTO storage.tenants (id,app_kind,backend_key,status,policy_version) VALUES ($1,'medusa',$1,'active','1') ON CONFLICT DO NOTHING", [tenantId]);
        await client.query("INSERT INTO storage.actors (tenant_id,actor_id,host_subject,role,state,last_policy_version) VALUES ($1,$2,$2,$3,'enabled','1')", [tenantId, actorId, role]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
  } finally { client.release(); }
}
