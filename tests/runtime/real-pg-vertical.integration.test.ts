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
import type { LawVerificationRequest } from "../../apps/service/src/laws/index.js";

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
const proofEnvironmentDigest = "0aed1f74bf00de83b25b565a54463767e550692b92fd242dd0397986e222be57";

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
    const recipientTenantId = `runtime-recipient-${randomUUID()}`;
    if (planPath === "direct") await seedTenant(recipientTenantId, "recipient-admin");
    const capabilities = ["medusa.products.list", "medusa.products.retrieve", "medusa.product_categories.retrieve", "medusa.sales_channels.retrieve", "medusa.product_categories.products.add", "medusa.sales_channels.products.add"];
    await apiStore.withTenant({ tenantId, actorId }, (tx) => tx.setCapabilityManifest({ id: randomUUID(), manifestHash: "b".repeat(64), adapterVersion: "medusa-v2", body: { capabilities, capabilityContract: "1", verifiedMedusaVersion: "2.22.1" }, idempotencyKey: randomUUID(), requestHash: "c".repeat(64) }));

    const bootstrap = generateKeyPairSync("ed25519"), publication = generateKeyPairSync("ed25519");
    const hostIdentity = { publicKey: async () => bootstrap.publicKey, reauthorize: async () => ({ active: true, roles: ["admin"] as const, policyVersion: "1" }) };
    const sessions = new SessionManager(new StorageSessionPersistence(apiStore), hostIdentity, { audience: "changedesk-test", issuers: ["fixture-host"], origins: ["http://runtime.test"], ticketMaxTtlSeconds: 60, sessionTtlSeconds: 300 });
    const connector = controlledHostFixture();
    const catalog = createProductionCatalog(apiStore, { publicationKeyId: "fixture-publication-key", publicationPrivateKey: publication.privateKey });
    let mismatchProof = false;
    const verifier = { verify: vi.fn(async (request: LawVerificationRequest) => reviewedProof(request, mismatchProof)) };
    const proofRequired = planPath === "direct";
    const operations = new StorageApiOperations(apiStore, connector as any, { [tenantId]: { category: ["category-1"], channel: [] }, ...(proofRequired ? { [recipientTenantId]: { category: [], channel: [] } } : {}) }, catalog, "fixture-publication-key", undefined, proofRequired, "fake", verifier, proofEnvironmentDigest);
    const app = buildApi({ config: testConfig(proofRequired), sessions, operations });

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
    if (proofRequired) {
      expect(plan.evidenceRefs).toHaveLength(1);
      expect(verifier.verify).toHaveBeenCalledWith(expect.objectContaining({ artifactHash: candidate.artifactHash, planHash: plan.planHash, policyVersion: "1", scope: "association-set-laws-v1" }));
      const evidence = await app.inject({ method: "GET", url: `/v1/evidence/${plan.evidenceRefs[0]}`, headers: readHeaders(authorization) });
      expect(evidence.statusCode).toBe(200);
      expect(evidence.json()).toMatchObject({ id: plan.evidenceRefs[0], status: "passed", artifactHash: candidate.artifactHash, environmentDigest: proofEnvironmentDigest });
    } else {
      expect(plan.evidenceRefs).toEqual([]);
      expect(verifier.verify).not.toHaveBeenCalled();
    }
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

    if (proofRequired) {
      mismatchProof = true;
      const mismatched = await post(app, "/v1/plans", authorization, { requestId, selectedProductIds: ["product-1"], parameters: { categoryId: "category-1" } });
      expect(mismatched.statusCode).toBe(409);
      expect(mismatched.json()).toMatchObject({ error: { code: "PROOF_REQUIRED" } });
      expect(await evidenceStatusCount(tenantId, actorId, "blocked")).toBe(1);
      mismatchProof = false;
      const publication = await post(app, "/v1/publications", authorization, { artifactHash: candidate.artifactHash, visibility: "shared_allowlist", allowedTenantIds: [recipientTenantId] });
      expect(publication.statusCode).toBe(200);
      const revokedPlanResponse = await post(app, "/v1/plans", authorization, { requestId, selectedProductIds: ["product-1"], parameters: { categoryId: "category-1" } });
      expect(revokedPlanResponse.statusCode).toBe(200);
      const revokedPlanView = await app.inject({ method: "GET", url: `/v1/plans/${revokedPlanResponse.json().planId}`, headers: readHeaders(authorization) });
      expect(revokedPlanView.statusCode).toBe(200);
      const revokedPlan = revokedPlanView.json().plan;
      const revokedApprovalKey = randomUUID();
      const revokedApproval = await post(app, "/v1/approvals", authorization, { planId: revokedPlan.id, planHash: revokedPlan.planHash, expectedPlanVersion: revokedPlan.planVersion, idempotencyKey: revokedApprovalKey }, revokedApprovalKey);
      expect(revokedApproval.statusCode).toBe(200);
      const revokedExecutionKey = randomUUID();
      const revokedExecution = await post(app, "/v1/executions", authorization, { approvalId: revokedApproval.json().approvalId, idempotencyKey: revokedExecutionKey }, revokedExecutionKey);
      expect(revokedExecution.statusCode).toBe(200);
      const revoked = await post(app, `/v1/publications/${publication.json().publicationId}/revoke`, authorization, { reason: "fixture revocation" });
      expect(revoked.statusCode).toBe(200);
      await runWorkerUntil(worker, async () => (await apiStore.withTenant({ tenantId, actorId }, (tx) => tx.getExecution(revokedExecution.json().executionId)))?.state === "failed", "revoked artifact");
      expect(connector.executeAuthorized).toHaveBeenCalledOnce();
    }
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

  async function scopedAdminUpdate(tenantId: string, actorId: string, sql: string, parameters: string[]) {
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

  async function evidenceStatusCount(tenantId: string, actorId: string, status: string) {
    const client = await migrator.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)", [tenantId, actorId]);
      const result = await client.query<{ count: string }>("SELECT count(*) count FROM storage.evidence_bundles WHERE owner_tenant_id=$1 AND status=$2", [tenantId, status]);
      await client.query("COMMIT");
      return Number(result.rows[0]!.count);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
});

function controlledHostFixture() {
  return { readAuthorized: async ({ capability }: any) => capability === "medusa.products.retrieve" ? { id: "product-1", status: "published", locked: false, categories: [], sales_channels: [], protectedDigest: "d".repeat(64) } : { id: "category-1", name: "Fixture category" }, executeAuthorized: vi.fn().mockResolvedValue({ observed: true, receipt: { operation: "fixture-receipt" } }), reconcileOperation: vi.fn().mockResolvedValue({ state: "unknown" }) };
}
function testConfig(proofRequired = false): ServiceConfig { return { apiDatabaseUrl: runtimeUrl!, workerDatabaseUrl: workerUrl!, host: "127.0.0.1", port: 4100, publicOriginAllowlist: ["http://runtime.test"], sessionAudience: "changedesk-test", sessionIssuerAllowlist: ["fixture-host"], sessionTtlSeconds: 300, bridgeTicketMaxTtlSeconds: 60, bodyLimitBytes: 65_536, workerId: "fixture", workerLeaseSeconds: 30, workerGlobalCap: 2, hosts: [], publicationKeyId: "fixture-publication-key", publicationPrivateKeyPem: "unused", proofRequired, planner: { executable: "unused", executableSha256: "a".repeat(64), model: "fixture", allowedModels: ["fixture"], isolatedCwd: ".", outputSchemaPath: "unused", timeoutMs: 1_000, maxOutputBytes: 1_024, maxInputTokens: 1_000 } }; }
function mutationHeaders(authorization?: string, key = randomUUID()) { return { origin: "http://runtime.test", "idempotency-key": key, ...(authorization ? { authorization } : {}) }; }
function readHeaders(authorization: string) { return { origin: "http://runtime.test", authorization }; }
function post(app: ReturnType<typeof buildApi>, url: string, authorization: string, payload: unknown, key = randomUUID()) { return app.inject({ method: "POST", url, headers: mutationHeaders(authorization, key), payload }); }
async function runWorkerUntil(worker: DurableWorker, done: () => Promise<boolean>, lane: string) { for (let attempt = 0; attempt < 50; attempt++) { await worker.runOnce(`fixture-${lane}`); if (await done()) return; } throw new Error(`Fixture worker did not complete ${lane} within 50 claims`); }
function reviewedProof(request: LawVerificationRequest, mismatch: boolean) { return { ...request, status: "verified" as const, verifierVersion: "2.0.39" as const, binarySha256: "2ec160fa4486d33aff51e9eedcc294d6b531dc10c279c00b0c00685dae2045cd", modelHash: "ac9d10d08692f9259301edf9d897ddb782eb403b98f1fbeff13b9e987baa1596", lawsHash: "02584a23199db88ec67974a4e458a0e7f16f8ed9196b8c1ba5b0a08cfa6937ac", proofHash: "827e041bc627ff9db7416e9f7f25693e08a170c9d1146330a4c9221c40a344ae", toolchainHash: proofEnvironmentDigest, exitCode: 0, stdout: "CONTROLLED VERIFIER RESULT; NOT A KERNEL RUN", stderr: "", durationMs: 1, ...(mismatch ? { planHash: "f".repeat(64) } : {}) }; }
