import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApi } from "../../apps/service/src/api/server.js";
import { SessionManager, StorageSessionPersistence } from "../../apps/service/src/api/session.js";
import { StorageApiOperations } from "../../apps/service/src/api/storage-operations.js";
import type { ServiceConfig } from "../../apps/service/src/config.js";
import { createProductionCatalog, createProductionGenerationProcessor } from "../../apps/service/src/planner/index.js";
import { Store, JobStore } from "../../apps/service/src/storage/index.js";
import { runMigrations } from "../../apps/service/src/storage/migrations.js";
import { StorageRuntimeAdapter } from "../../apps/service/src/runtime/storage-adapter.js";
import { DurableWorker } from "../../apps/service/src/runtime/worker.js";
import { StrictEffectAuthority } from "../../apps/service/src/runtime/authority.js";
import { startWorker } from "../../apps/service/src/worker.js";

const migratorUrl = process.env.CHANGEDESK_MIGRATOR_DATABASE_URL;
const runtimeUrl = process.env.CHANGEDESK_RUNTIME_DATABASE_URL;
const workerUrl = process.env.CHANGEDESK_WORKER_DATABASE_URL;
if (!migratorUrl || !runtimeUrl || !workerUrl) throw new Error("BLOCKED: real runtime vertical requires the three ChangeDesk PostgreSQL role URLs");

const migrator = new Pool({ connectionString: migratorUrl });
const runtimePool = new Pool({ connectionString: runtimeUrl, max: 4 });
const workerPool = new Pool({ connectionString: workerUrl, max: 4 });
const apiStore = new Store(runtimePool);
const workerStore = new Store(workerPool);
const jobs = new JobStore(workerPool);
const migrationsDirectory = new URL("../../apps/service/migrations/", import.meta.url);

describe("real PostgreSQL API-to-worker vertical with controlled host/provider fixtures", () => {
  beforeAll(async () => { await runMigrations(migrator, migrationsDirectory); });
  afterAll(async () => { await Promise.all([migrator.end(), runtimePool.end(), workerPool.end()]); });

  it("keeps a worker lane alive after one unexpected job failure", async () => {
    const controller = new AbortController();
    const runOnce = vi.fn(async () => {
      if (runOnce.mock.calls.length === 1) throw new Error("fixture job failure");
      controller.abort();
      return "idle" as const;
    });
    const recoverOrphanedLeases = vi.fn().mockResolvedValue(0);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await startWorker({ runOnce, recoverOrphanedLeases } as unknown as DurableWorker, { workerId: "survival", signal: controller.signal, idleDelayMs: 1, recoveryIntervalMs: 60_000 });
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/lease left for fenced recovery/));
  });

  it.each(["direct", "installation"] as const)("exchanges a ticket and executes the %s plan path through durable jobs", async (planPath) => {
    const tenantId = `runtime-${randomUUID()}`, actorId = "admin-operator", hostSessionId = randomUUID();
    await seedTenant(tenantId, actorId);
    const capabilities = ["medusa.products.list", "medusa.products.retrieve", "medusa.product_categories.retrieve", "medusa.sales_channels.retrieve", "medusa.product_categories.products.add", "medusa.sales_channels.products.add"];
    await apiStore.withTenant({ tenantId, actorId }, (tx) => tx.setCapabilityManifest({ id: randomUUID(), manifestHash: "b".repeat(64), adapterVersion: "medusa-v2", body: { capabilities, capabilityContract: "1", verifiedMedusaVersion: "2.22.1" }, idempotencyKey: randomUUID(), requestHash: "c".repeat(64) }));

    const bootstrap = generateKeyPairSync("ed25519"), publication = generateKeyPairSync("ed25519");
    const hostIdentity = { publicKey: async () => bootstrap.publicKey, reauthorize: async () => ({ active: true, roles: ["admin"] as const, policyVersion: "1" }) };
    const sessions = new SessionManager(new StorageSessionPersistence(apiStore), hostIdentity, { audience: "changedesk-test", issuers: ["fixture-host"], origins: ["http://runtime.test"], ticketMaxTtlSeconds: 60, sessionTtlSeconds: 300 });
    const connector = controlledHostFixture();
    const catalog = createProductionCatalog(apiStore, { publicationKeyId: "fixture-publication-key", publicationPrivateKey: publication.privateKey });
    const operations = new StorageApiOperations(apiStore, connector as any, { [tenantId]: { category: ["category-1"], channel: [] } }, catalog, "fixture-publication-key", undefined, false, "fake");
    const app = buildApi({ config: testConfig(), sessions, operations });

    const now = Math.floor(Date.now() / 1000);
    const claims = { v: 1, typ: "changedesk.bootstrap", iss: "fixture-host", aud: "changedesk-test", sub: actorId, tenantId, hostSessionId, policyVersion: "1", origin: "http://runtime.test", jti: randomUUID(), iat: now, exp: now + 60 } as const;
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const ticket = `${payload}.${sign(null, Buffer.from(payload, "base64url"), bootstrap.privateKey).toString("base64url")}`;
    const exchange = await app.inject({ method: "POST", url: "/v1/session/exchange", headers: mutationHeaders(), payload: { ticket } });
    expect(exchange.statusCode).toBe(200);
    const authorization = `Bearer ${exchange.json().accessToken}`;

    const request = await post(app, "/v1/requests", authorization, { message: "Assign a category to the selected products", selectedProductIds: ["product-1"], clientRequestId: randomUUID() });
    expect(request.statusCode).toBe(200);
    const requestId = request.json().requestId as string;

    const workerCatalog = createProductionCatalog(workerStore, { publicationKeyId: "fixture-publication-key", publicationPrivateKey: publication.privateKey });
    const generation = createProductionGenerationProcessor({ store: workerStore, catalog: workerCatalog, planner: { kind: "fake-test", allowExplicitTestFake: true }, workerLeaseSeconds: 30, maxAttempts: 3, totalTokenBudget: 10_000n, costBudgetMicros: 0n });
    const adapter = new StorageRuntimeAdapter(workerStore as any, jobs as any, { workerActorId: "lease-actor", leaseSeconds: 30, globalCap: 2 });
    const worker = new DurableWorker({ store: adapter, connector: connector as any, authority: new StrictEffectAuthority(), generation });
    await runWorkerUntil(worker, async () => (await apiStore.withTenant({ tenantId, actorId }, (tx) => tx.listRequestCandidates(requestId))).length > 0, "generation");

    const candidates = await app.inject({ method: "GET", url: `/v1/requests/${requestId}/candidates`, headers: readHeaders(authorization) });
    expect(candidates.statusCode).toBe(200);
    const requestView = await app.inject({ method: "GET", url: `/v1/requests/${requestId}`, headers: readHeaders(authorization) });
    expect(requestView.json().providerMode).toBe("fake");
    const candidate = candidates.json().candidates[0];
    expect(candidate).toMatchObject({ compatibility: "compatible", version: "1" });
    const selected = await post(app, `/v1/requests/${requestId}/candidate`, authorization, { candidateId: candidate.id, version: candidate.version, choice: "reuse" });
    expect(selected.statusCode).toBe(200);

    let planSource: { requestId: string } | { installationId: string } = { requestId };
    if (planPath === "installation") {
      const installed = await post(app, "/v1/installations", authorization, { artifactHash: candidate.artifactHash, configuration: { categoryId: "category-1" } });
      expect(installed.statusCode).toBe(200);
      planSource = { installationId: installed.json().installationId };
    }
    const planCreated = await post(app, "/v1/plans", authorization, { ...planSource, selectedProductIds: ["product-1"], parameters: { categoryId: "category-1" } });
    expect(planCreated.statusCode).toBe(200);
    const planView = await app.inject({ method: "GET", url: `/v1/plans/${planCreated.json().planId}`, headers: readHeaders(authorization) });
    expect(planView.statusCode).toBe(200);
    expect(planView.json().summary).toMatchObject({ selected: 1, eligible: 1, additions: 1, excluded: 0 });

    const plan = planView.json().plan;
    const approvalKey = randomUUID();
    const approval = await post(app, "/v1/approvals", authorization, { planId: plan.id, planHash: plan.planHash, expectedPlanVersion: plan.planVersion, idempotencyKey: approvalKey }, approvalKey);
    expect(approval.statusCode).toBe(200);
    const approvalReplay = await post(app, "/v1/approvals", authorization, { planId: plan.id, planHash: plan.planHash, expectedPlanVersion: plan.planVersion, idempotencyKey: approvalKey }, approvalKey);
    expect(approvalReplay.statusCode).toBe(200);
    expect(approvalReplay.json()).toEqual(approval.json());
    const executionKey = randomUUID();
    const execution = await post(app, "/v1/executions", authorization, { approvalId: approval.json().approvalId, idempotencyKey: executionKey }, executionKey);
    expect(execution.statusCode).toBe(200);
    const executionReplay = await post(app, "/v1/executions", authorization, { approvalId: approval.json().approvalId, idempotencyKey: executionKey }, executionKey);
    expect(executionReplay.statusCode).toBe(200);
    expect(executionReplay.json()).toEqual(execution.json());

    // Simulate a process crash after claim. Recovery must fence the abandoned lease,
    // and a fresh worker must complete the same durable execution exactly once.
    const [abandoned] = await jobs.claimNext({ workerId: "crashed-worker", leaseSeconds: 5, globalCap: 2, limit: 1 });
    expect(abandoned?.executionId).toBe(execution.json().executionId);
    await expireLease(tenantId, actorId, abandoned!.jobId);
    expect(await adapter.recoverOrphanedLeases(1)).toBe(1);
    await runWorkerUntil(worker, async () => (await apiStore.withTenant({ tenantId, actorId }, (tx) => tx.getExecution(execution.json().executionId)))?.state === "succeeded", "execution");

    const detail = await app.inject({ method: "GET", url: `/v1/executions/${execution.json().executionId}`, headers: readHeaders(authorization) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ state: "succeeded", rows: [{ rowId: "product-1", state: "succeeded", steps: [{ state: "succeeded" }] }] });
    expect(connector.executeAuthorized).toHaveBeenCalledOnce();

    // Cancellation is durable and prevents the queued ledger from sending effects.
    const cancelledPlanResponse = await post(app, "/v1/plans", authorization, { ...planSource, selectedProductIds: ["product-1"], parameters: { categoryId: "category-1" } });
    expect(cancelledPlanResponse.statusCode).toBe(200);
    const cancelledPlanView = await app.inject({ method: "GET", url: `/v1/plans/${cancelledPlanResponse.json().planId}`, headers: readHeaders(authorization) });
    expect(cancelledPlanView.statusCode).toBe(200);
    const cancelledPlan = cancelledPlanView.json().plan;
    const cancelledApprovalKey = randomUUID();
    const cancelledApproval = await post(app, "/v1/approvals", authorization, { planId: cancelledPlan.id, planHash: cancelledPlan.planHash, expectedPlanVersion: cancelledPlan.planVersion, idempotencyKey: cancelledApprovalKey }, cancelledApprovalKey);
    expect(cancelledApproval.statusCode).toBe(200);
    const cancelledExecutionKey = randomUUID();
    const cancelledExecution = await post(app, "/v1/executions", authorization, { approvalId: cancelledApproval.json().approvalId, idempotencyKey: cancelledExecutionKey }, cancelledExecutionKey);
    expect(cancelledExecution.statusCode).toBe(200);
    const cancelKey = randomUUID();
    const cancelled = await post(app, `/v1/executions/${cancelledExecution.json().executionId}/cancel`, authorization, {}, cancelKey);
    expect(cancelled.statusCode).toBe(200);
    await runWorkerUntil(worker, async () => (await apiStore.withTenant({ tenantId, actorId }, (tx) => tx.getExecution(cancelledExecution.json().executionId)))?.state === "cancelled", "cancelled execution");
    expect(connector.executeAuthorized).toHaveBeenCalledOnce();

    // Authority is checked by the worker, not only at admission. Expiration after
    // admission prevents effects, and resume cannot revive the stale approval.
    const expiredPlanResponse = await post(app, "/v1/plans", authorization, { ...planSource, selectedProductIds: ["product-1"], parameters: { categoryId: "category-1" } });
    expect(expiredPlanResponse.statusCode).toBe(200);
    const expiredPlanView = await app.inject({ method: "GET", url: `/v1/plans/${expiredPlanResponse.json().planId}`, headers: readHeaders(authorization) });
    expect(expiredPlanView.statusCode).toBe(200);
    const expiredPlan = expiredPlanView.json().plan;
    const expiredApprovalKey = randomUUID();
    const expiredApproval = await post(app, "/v1/approvals", authorization, { planId: expiredPlan.id, planHash: expiredPlan.planHash, expectedPlanVersion: expiredPlan.planVersion, idempotencyKey: expiredApprovalKey }, expiredApprovalKey);
    expect(expiredApproval.statusCode).toBe(200);
    const expiredExecutionKey = randomUUID();
    const expiredExecution = await post(app, "/v1/executions", authorization, { approvalId: expiredApproval.json().approvalId, idempotencyKey: expiredExecutionKey }, expiredExecutionKey);
    expect(expiredExecution.statusCode).toBe(200);
    await expireApproval(tenantId, actorId, expiredApproval.json().approvalId);
    await runWorkerUntil(worker, async () => (await apiStore.withTenant({ tenantId, actorId }, (tx) => tx.getExecution(expiredExecution.json().executionId)))?.state === "failed", "expired authority");
    expect(connector.executeAuthorized).toHaveBeenCalledOnce();
    const resumeKey = randomUUID();
    const resumed = await post(app, `/v1/executions/${expiredExecution.json().executionId}/resume`, authorization, {}, resumeKey);
    expect(resumed.statusCode).toBe(200);
    expect(await worker.runOnce("fixture-expired-resume")).toMatchObject({ kind: "authority_expired" });
    expect(connector.executeAuthorized).toHaveBeenCalledOnce();
    await app.close();
  });

  async function seedTenant(tenantId: string, actorId: string) {
    const client = await migrator.connect();
    try { await client.query("BEGIN"); await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)", [tenantId, actorId]); await client.query("INSERT INTO storage.tenants(id,app_kind,backend_key,status,policy_version) VALUES($1,'medusa',$1,'active','1')", [tenantId]); await client.query("INSERT INTO storage.actors(tenant_id,actor_id,host_subject,role,state,last_policy_version) VALUES($1,$2,$2,'admin','enabled','1')", [tenantId, actorId]); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function expireLease(tenantId: string, actorId: string, jobId: string) {
    await scopedAdminUpdate(tenantId, actorId, "UPDATE storage.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND id=$2 AND status='leased'", [tenantId, jobId]);
  }

  async function expireApproval(tenantId: string, actorId: string, approvalId: string) {
    await scopedAdminUpdate(tenantId, actorId, "UPDATE storage.approvals SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND id=$2", [tenantId, approvalId]);
  }

  async function scopedAdminUpdate(tenantId: string, actorId: string, sql: string, parameters: readonly string[]) {
    const client = await migrator.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)", [tenantId, actorId]);
      const result = await client.query(sql, parameters);
      expect(result.rowCount).toBe(1);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
});

function controlledHostFixture() {
  return { readAuthorized: async ({ capability }: any) => capability === "medusa.products.retrieve" ? { id: "product-1", status: "published", locked: false, categories: [], sales_channels: [], protectedDigest: "d".repeat(64) } : { id: "category-1", name: "Fixture category" }, executeAuthorized: vi.fn().mockResolvedValue({ observed: true, receipt: { operation: "fixture-receipt" } }), reconcileOperation: vi.fn().mockResolvedValue({ state: "unknown" }) };
}
function testConfig(): ServiceConfig { return { apiDatabaseUrl: runtimeUrl!, workerDatabaseUrl: workerUrl!, host: "127.0.0.1", port: 4100, publicOriginAllowlist: ["http://runtime.test"], sessionAudience: "changedesk-test", sessionIssuerAllowlist: ["fixture-host"], sessionTtlSeconds: 300, bridgeTicketMaxTtlSeconds: 60, bodyLimitBytes: 65_536, workerId: "fixture", workerLeaseSeconds: 30, workerGlobalCap: 2, hosts: [], publicationKeyId: "fixture-publication-key", publicationPrivateKeyPem: "unused", proofRequired: false, planner: { executable: "unused", executableSha256: "a".repeat(64), model: "fixture", allowedModels: ["fixture"], isolatedCwd: ".", outputSchemaPath: "unused", timeoutMs: 1_000, maxOutputBytes: 1_024, maxInputTokens: 1_000 } }; }
function mutationHeaders(authorization?: string, key = randomUUID()) { return { origin: "http://runtime.test", "idempotency-key": key, ...(authorization ? { authorization } : {}) }; }
function readHeaders(authorization: string) { return { origin: "http://runtime.test", authorization }; }
function post(app: ReturnType<typeof buildApi>, url: string, authorization: string, payload: unknown, key = randomUUID()) { return app.inject({ method: "POST", url, headers: mutationHeaders(authorization, key), payload }); }
async function runWorkerUntil(worker: DurableWorker, done: () => Promise<boolean>, lane: string) { for (let attempt = 0; attempt < 50; attempt++) { await worker.runOnce(`fixture-${lane}`); if (await done()) return; } throw new Error(`Fixture worker did not complete ${lane} within 50 claims`); }
