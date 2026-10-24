import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobStore, Store, StorageConflictError, TicketReplayStore } from "../../apps/service/src/storage/index.js";
import { runMigrations } from "../../apps/service/src/storage/migrations.js";

const migratorUrl = process.env.CHANGEDESK_MIGRATOR_DATABASE_URL;
const runtimeUrl = process.env.CHANGEDESK_RUNTIME_DATABASE_URL;
const workerUrl = process.env.CHANGEDESK_WORKER_DATABASE_URL;
if (!migratorUrl || !runtimeUrl || !workerUrl) {
  throw new Error("BLOCKED: CHANGEDESK_MIGRATOR_DATABASE_URL, CHANGEDESK_RUNTIME_DATABASE_URL, and CHANGEDESK_WORKER_DATABASE_URL are required for real PostgreSQL storage tests");
}

const migrator = new Pool({ connectionString: migratorUrl });
const runtime = new Pool({ connectionString: runtimeUrl, application_name: "changedesk-storage-test-runtime", max: 4 });
const reuseRuntime = new Pool({ connectionString: runtimeUrl, application_name: "changedesk-storage-test-reuse", max: 1 });
const worker = new Pool({ connectionString: workerUrl, application_name: "changedesk-storage-test-worker", max: 2 });
const store = new Store(runtime);
const reuseStore = new Store(reuseRuntime);
const jobs = new JobStore(worker);
const tickets = new TicketReplayStore(store);
const workerStore = new Store(worker);
const migrationsDirectory = new URL("../../apps/service/migrations/", import.meta.url);

describe("PostgreSQL storage integration", () => {
  beforeAll(async () => {
    await runMigrations(migrator, migrationsDirectory);
    const identity = await runtime.query<{rolsuper:boolean;rolbypassrls:boolean;owns_storage:boolean}>(
      `SELECT r.rolsuper,r.rolbypassrls,
        EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='storage' AND c.relowner=r.oid) owns_storage
       FROM pg_roles r WHERE r.rolname=current_user`,
    );
    expect(identity.rows).toEqual([{ rolsuper: false, rolbypassrls: false, owns_storage: false }]);
    const workerIdentity=await worker.query<{rolsuper:boolean;rolbypassrls:boolean;owns_storage:boolean}>(`SELECT r.rolsuper,r.rolbypassrls,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relowner=r.oid) owns_storage
      FROM pg_roles r WHERE r.rolname=current_user`);
    expect(workerIdentity.rows).toEqual([{rolsuper:false,rolbypassrls:false,owns_storage:false}]);
  });

  afterAll(async () => {
    await Promise.all([runtime.end(), reuseRuntime.end(), worker.end(), migrator.end()]);
  });

  it("ACC-010 reuses one pool connection without leaking the previous tenant", async () => {
    const atlas = `atlas-${randomUUID()}`;
    const boreal = `boreal-${randomUUID()}`;
    await seedTenant(atlas, "actor-a");
    await seedTenant(boreal, "actor-b");

    await reuseStore.withTenant({ tenantId: atlas, actorId: "actor-a" }, (tx) =>
      tx.createRequestAndJob({
        id: randomUUID(),
        actorId: "actor-a",
        redactedText: "atlas canary",
        contextRef: {},
        budget: {},
        jobId: randomUUID(),
        idempotencyKey: randomUUID(),
        requestHash: "1".repeat(64),
      }),
    );

    const borealRows = await reuseStore.withTenant({ tenantId: boreal, actorId: "actor-b" }, (tx) =>
      tx.listRequests(),
    );
    expect(borealRows).toEqual([]);
  });

  it("ACC-010 rejects a real cross-tenant composite FK and accepts its same-tenant control", async () => {
    const atlas = `atlas-${randomUUID()}`;
    const boreal = `boreal-${randomUUID()}`;
    await seedTenant(atlas, "same-actor");
    await seedTenant(boreal, "same-actor");

    const atlasRequest = await store.withTenant({ tenantId: atlas, actorId: "same-actor" }, (tx) =>
      tx.createRequestAndJob({ id: randomUUID(), actorId: "same-actor", redactedText: "atlas", contextRef: {}, budget: {}, jobId: randomUUID(), idempotencyKey: randomUUID(), requestHash: "2".repeat(64) }),
    );
    const borealRequest = await store.withTenant({ tenantId: boreal, actorId: "same-actor" }, (tx) =>
      tx.createRequestAndJob({ id: randomUUID(), actorId: "same-actor", redactedText: "boreal", contextRef: {}, budget: {}, jobId: randomUUID(), idempotencyKey: randomUUID(), requestHash: "6".repeat(64) }),
    );
    await store.withTenant({ tenantId: boreal, actorId: "same-actor" }, (tx) =>
      tx.createPlan(testPlan({ requestId: borealRequest.id, actorId: "same-actor", idempotencyKey: randomUUID(), requestHash: "7".repeat(64) })),
    );

    const client = await migrator.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)",[boreal,"same-actor"]);
      await expect(client.query(`INSERT INTO storage.plans (tenant_id,id,request_id,actor_id,artifact_hash,adapter_version,policy_version,capability_manifest_hash,body,plan_hash,plan_version,state,expires_at)
        VALUES ($1,$2,$3,$4,$5,'1','1',$6,'{}',$7,1,'ready',clock_timestamp()+interval '1 minute')`,
        [boreal,randomUUID(),atlasRequest.id,"same-actor","a".repeat(64),"b".repeat(64),"c".repeat(64)])).rejects.toMatchObject({code:"23503"});
      await client.query("ROLLBACK");
    } finally { client.release(); }
  });

  it("ACC-006 concurrent approvals and starts with different HTTP keys converge by business key", async () => {
    const tenantId = `tenant-${randomUUID()}`;
    const actorId = "operator";
    await seedTenant(tenantId, actorId);
    const ids = await seedReadyPlan(tenantId, actorId);
    const hostSessionId=await seedHostSession(tenantId,actorId);

    const approvalInputs = [randomUUID(), randomUUID()].map((key) => ({
      id: randomUUID(),
      planId: ids.planId,
      planVersion: 1,
      planHash: ids.planHash,
      actorId,
      hostSessionId,
      scope: ["execute"],
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: key,
      requestHash: ids.planHash,
    }));
    const approvals = await Promise.all(
      approvalInputs.map((input) =>
        store.withTenant({ tenantId, actorId }, (tx) => tx.createApproval(input)),
      ),
    );
    expect(new Set(approvals.map((item) => item.id)).size).toBe(1);
    const approval=approvals[0]!;

    const starts = await Promise.all(
      [randomUUID(), randomUUID()].map((key) =>
        store.withTenant({ tenantId, actorId }, (tx) =>
          tx.admitExecution({
            id: randomUUID(),
            approvalId: approval.id,
            actorId,
            jobId: randomUUID(),
            idempotencyKey: key,
            requestHash: ids.planHash,
          }),
        ),
      ),
    );
    expect(new Set(starts.map((item) => item.id)).size).toBe(1);
  });

  it("ACC-006 same HTTP idempotency key with a different body conflicts", async () => {
    const tenantId = `tenant-${randomUUID()}`;
    await seedTenant(tenantId, "operator");
    const key = randomUUID();
    await store.withTenant({ tenantId, actorId: "operator" }, (tx) =>
      tx.createRequestAndJob({
        id: randomUUID(), actorId: "operator", redactedText: "a", contextRef: {}, budget: {}, jobId: randomUUID(),
        idempotencyKey: key, requestHash: "a".repeat(64),
      }),
    );
    await expect(
      store.withTenant({ tenantId, actorId: "operator" }, (tx) =>
        tx.createRequestAndJob({
          id: randomUUID(), actorId: "operator", redactedText: "b", contextRef: {}, budget: {}, jobId: randomUUID(),
          idempotencyKey: key, requestHash: "b".repeat(64),
        }),
      ),
    ).rejects.toBeInstanceOf(StorageConflictError);
  });

  it("ACC-010 rolls back the whole tenant transaction on callback failure", async () => {
    const tenantId=`tenant-${randomUUID()}`;
    const actorId="operator";
    await seedTenant(tenantId,actorId);
    const requestId=randomUUID();
    await expect(store.withTenant({tenantId,actorId},async(tx)=>{
      await tx.createRequestAndJob({id:requestId,actorId,redactedText:"rollback",contextRef:{},budget:{},jobId:randomUUID(),idempotencyKey:randomUUID(),requestHash:"8".repeat(64)});
      throw new Error("expected rollback");
    })).rejects.toThrow("expected rollback");
    const requests=await store.withTenant({tenantId,actorId},(tx)=>tx.listRequests());
    expect(requests.find((request)=>request.id===requestId)).toBeUndefined();
  });

  it("ACC-003 consumes a bridge ticket once by issuer and jti",async()=>{
    const tenantId=`tenant-${randomUUID()}`;
    const actorId="operator";
    await seedTenant(tenantId,actorId);
    const jti=randomUUID();
    const input={tenantId,actorId,ticketId:randomUUID(),issuer:"medusa-test",jti,audience:"changedesk",expiresAt:new Date(Date.now()+60_000)};
    expect(await tickets.consumeTicket(input)).toBe(true);
    expect(await tickets.consumeTicket({...input,ticketId:randomUUID()})).toBe(false);
  });

  it("ACC-008 claims fairly and rejects a stale fencing token",async()=>{
    const firstTenant=`tenant-${randomUUID()}`;
    const secondTenant=`tenant-${randomUUID()}`;
    await seedTenant(firstTenant,"operator");
    await seedTenant(secondTenant,"operator");
    for(const [tenantId,hash] of [[firstTenant,"9"],[firstTenant,"a"],[secondTenant,"b"]] as const) {
      await store.withTenant({tenantId,actorId:"operator"},(tx)=>tx.createRequestAndJob({id:randomUUID(),actorId:"operator",redactedText:"job",contextRef:{},budget:{},jobId:randomUUID(),idempotencyKey:randomUUID(),requestHash:hash.repeat(64)}));
    }
    const leases=await jobs.claimNext({workerId:`worker-${randomUUID()}`,leaseSeconds:30,globalCap:2,limit:2});
    expect(leases).toHaveLength(2);
    expect(new Set(leases.map((lease)=>lease.tenantId)).size).toBe(2);
    const claimed=leases[0]!;
    expect(await jobs.heartbeat({...claimed,fence:claimed.fence-1},30)).toBe(false);
    expect(await jobs.heartbeat(claimed,30)).toBe(true);
    const claimedResource=claimed.requestId
      ? await workerStore.withTenant({tenantId:claimed.tenantId,actorId:claimed.actorId},(tx)=>tx.getRequest(claimed.requestId!))
      : await workerStore.withTenant({tenantId:claimed.tenantId,actorId:claimed.actorId},(tx)=>tx.getExecution(claimed.executionId!));
    expect(claimedResource).not.toBeNull();
    await Promise.all(leases.map((lease)=>jobs.finish(lease,{status:"completed"})));
  });

  it("ACC-009 recovers an expired lease without allowing the old worker to finish it",async()=>{
    const tenantId=`tenant-${randomUUID()}`;
    await seedTenant(tenantId,"operator");
    await store.withTenant({tenantId,actorId:"operator"},(tx)=>tx.createRequestAndJob({id:randomUUID(),actorId:"operator",redactedText:"recover",contextRef:{},budget:{},jobId:randomUUID(),idempotencyKey:randomUUID(),requestHash:"d".repeat(64)}));
    const lease=(await jobs.claimNext({workerId:`worker-${randomUUID()}`,leaseSeconds:30,globalCap:1}))[0]!;
    expect(lease).toBeDefined();
    await migrator.query("UPDATE storage.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[lease.jobId]);
    await migrator.query("UPDATE storage.capacity_leases SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id=$1",[lease.jobId]);
    expect(await jobs.finish(lease,{status:"completed"})).toBe(false);
    expect(await jobs.recoverExpired()).toBeGreaterThanOrEqual(1);
    expect(await jobs.finish(lease,{status:"completed"})).toBe(false);
  });

  it("ACC-009 reloads private generation input after restart only under its live fence",async()=>{
    const tenantId=`tenant-${randomUUID()}`;
    const actorId="operator";
    await seedTenant(tenantId,actorId);
    const requestId=randomUUID();
    const jobId=randomUUID();
    const contextRef={locale:"es",selectedProductIds:["product-1"]};
    await store.withTenant({tenantId,actorId},async(tx)=>{
      await tx.setCapabilityManifest({id:randomUUID(),manifestHash:"e".repeat(64),adapterVersion:"medusa-v2",body:{capabilities:["medusa.products.list"]},idempotencyKey:randomUUID(),requestHash:"f".repeat(64)});
      await tx.createRequestAndJob({id:requestId,actorId,redactedText:"prepara la campaña",contextRef,budget:{maxGenerationAttempts:2},jobId,idempotencyKey:randomUUID(),requestHash:"0".repeat(64)});
    });
    let targetLease;
    for(let count=0;count<20 && !targetLease;count++) {
      const [candidate]=await jobs.claimNext({workerId:`worker-${randomUUID()}`,leaseSeconds:30,globalCap:4});
      if(!candidate) break;
      if(candidate.jobId===jobId) targetLease=candidate;
      else await jobs.finish(candidate,{status:"completed"});
    }
    expect(targetLease).toBeDefined();
    const bundle=await workerStore.withTenant({tenantId,actorId},(tx)=>tx.loadGenerationBundle(targetLease!));
    expect(bundle).toMatchObject({request:{id:requestId,redactedText:"prepara la campaña",contextRef},tenant:{policyVersion:"1"},capabilityManifest:{manifestHash:"e".repeat(64)}});
    expect(await workerStore.withTenant({tenantId,actorId},(tx)=>tx.loadGenerationBundle({...targetLease!,fence:targetLease!.fence-1}))).toBeNull();
    const candidate={id:randomUUID(),version:"1",artifactHash:null,recipeKey:"catalog.campaign.prepare.v1",displayName:"Preparar campaña",requiredCapabilities:["medusa.products.list"],compatibility:"compatible" as const,evidenceStatus:"not_run" as const,estimatedCost:null,safeMetadata:{source:"generated"}};
    expect(await workerStore.withTenant({tenantId,actorId},(tx)=>tx.addRequestCandidates(targetLease!,requestId,[candidate]))).toBe(true);
    expect(await store.withTenant({tenantId,actorId},(tx)=>tx.listRequestCandidates(requestId))).toMatchObject([{id:candidate.id,state:"offered"}]);
    expect(await store.withTenant({tenantId,actorId},(tx)=>tx.selectRequestCandidate({requestId,candidateId:candidate.id,version:"1",choice:"reuse",idempotencyKey:randomUUID(),requestHash:"7".repeat(64)}))).toMatchObject({id:candidate.id,state:"selected",selectedChoice:"reuse"});
    await jobs.finish(targetLease!,{status:"completed"});
  });

  it("ACC-008 preserves attempt state across recovery and requires fenced business transitions",async()=>{
    const tenantId=`tenant-${randomUUID()}`;
    const actorId="operator";
    await seedTenant(tenantId,actorId);
    const ids=await seedReadyPlan(tenantId,actorId);
    const evidenceId=randomUUID();
    await store.withTenant({tenantId,actorId},async(tx)=>{
      await tx.insertEvidence({id:evidenceId,artifactHash:ids.artifactHash,environmentDigest:"environment",suiteVersion:"1",status:"passed",artifactRefs:{},privacyScope:"private"});
      expect(await tx.getEvidence(evidenceId)).toMatchObject({id:evidenceId,status:"passed",privacyScope:"private"});
    });
    const hostSessionId=await seedHostSession(tenantId,actorId);
    const approval=await store.withTenant({tenantId,actorId},(tx)=>tx.createApproval({id:randomUUID(),planId:ids.planId,planVersion:1,planHash:ids.planHash,actorId,hostSessionId,scope:["execute"],expiresAt:new Date(Date.now()+60_000),idempotencyKey:randomUUID(),requestHash:"1".repeat(64)}));
    const executionJobId=randomUUID();
    const execution=await store.withTenant({tenantId,actorId},(tx)=>tx.admitExecution({id:randomUUID(),approvalId:approval.id,actorId,jobId:executionJobId,idempotencyKey:randomUUID(),requestHash:"2".repeat(64)}));
    let lease;
    for(let count=0;count<30 && !lease;count++) {
      const [candidate]=await jobs.claimNext({workerId:`worker-${randomUUID()}`,leaseSeconds:30,globalCap:4});
      if(!candidate) break;
      if(candidate.jobId===executionJobId) lease=candidate;
      else await jobs.finish(candidate,{status:"completed"});
    }
    expect(lease).toBeDefined();
    const attempt={executionId:execution.id,rowId:"product-1",stepId:"category",attemptNo:1,semanticInputHash:"3".repeat(64),operationKey:randomUUID()};
    await workerStore.withTenant({tenantId,actorId},async(tx)=>{
      expect(await tx.insertExecutionRows(lease!,execution.id,[{rowId:"product-1",resourceRef:"product-1",preconditionFingerprint:"precondition"}])).toBe(true);
      expect(await tx.updateExecutionWithLease(lease!,execution.id,"running",0)).toMatchObject({state:"running",revision:1});
      expect(await tx.recordAttemptIntent(lease!,attempt)).toMatchObject({inserted:true,state:"intent_recorded",operationKey:attempt.operationKey});
      expect(await tx.recordAttemptIntent(lease!,attempt)).toMatchObject({inserted:false,state:"intent_recorded"});
      const claim={executionId:execution.id,planHash:ids.planHash,planVersion:1,approvalId:approval.id,operationKey:attempt.operationKey,jobId:lease!.jobId,leaseOwner:lease!.leaseOwner,fence:lease!.fence,hostSessionId,policyVersion:"1"};
      expect(await tx.authorizeEffectClaim(claim)).toMatchObject({authorized:true,executionId:execution.id,hostSessionId});
      expect(await tx.authorizeEffectClaim({...claim,fence:claim.fence-1})).toEqual({authorized:false,reasonCode:"claim_invalid"});
      expect(await tx.transitionAttempt(lease!,attempt,"sent","receipt-1")).toBe(true);
      expect(await tx.authorizeEffectClaim(claim)).toMatchObject({authorized:true,executionId:execution.id});
    });
    await migrator.query("UPDATE storage.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[lease!.jobId]);
    await migrator.query("UPDATE storage.capacity_leases SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id=$1",[lease!.jobId]);
    await jobs.recoverExpired();
    let reconcileLease;
    for(let count=0;count<30 && !reconcileLease;count++) {
      const [candidate]=await jobs.claimNext({workerId:`worker-${randomUUID()}`,leaseSeconds:30,globalCap:4});
      if(!candidate) break;
      if(candidate.jobId===executionJobId) reconcileLease=candidate;
      else await jobs.finish(candidate,{status:"completed"});
    }
    expect(reconcileLease).toBeDefined();
    await workerStore.withTenant({tenantId,actorId},async(tx)=>{
      expect(await tx.adoptAttemptForReconciliation(reconcileLease!,attempt)).toMatchObject({state:"sent",receiptRef:"receipt-1",inserted:false});
      expect(await tx.transitionAttempt(reconcileLease!,attempt,"confirmed","receipt-1","observation-1")).toBe(true);
      expect(await tx.updateRowWithLease(reconcileLease!,{executionId:execution.id,rowId:"product-1",state:"succeeded",finalObservationRef:"observation-1"})).toBe(true);
      expect(await tx.updateExecutionWithLease(reconcileLease!,execution.id,"succeeded",1)).toMatchObject({state:"succeeded",revision:2});
      expect(await tx.loadExecutionBundle(execution.id)).toMatchObject({authority:{hostSessionId}});
    });
    expect(await jobs.finish(reconcileLease!,{status:"completed"})).toBe(true);
    expect(await store.withTenant({tenantId,actorId},(tx)=>tx.getExecution(execution.id))).toMatchObject({state:"succeeded",revision:2});
  });

  async function seedTenant(tenantId: string, actorId: string) {
    const client = await migrator.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)",[tenantId,actorId]);
      await client.query("INSERT INTO storage.tenants (id, app_kind, backend_key, status, policy_version) VALUES ($1, 'medusa', $1, 'active', '1') ON CONFLICT DO NOTHING", [tenantId]);
      await client.query("INSERT INTO storage.actors (tenant_id, actor_id, host_subject, role, state, last_policy_version) VALUES ($1, $2, $2, 'operator', 'enabled', '1') ON CONFLICT DO NOTHING", [tenantId, actorId]);
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function seedReadyPlan(tenantId: string, actorId: string) {
    const requestId = randomUUID();
    const planId = randomUUID();
    const planHash = "c".repeat(64);
    const artifactHash=randomUUID().replaceAll("-","").padEnd(64,"0");
    await store.withTenant({ tenantId, actorId }, async (tx) => {
      await tx.insertArtifact({id:randomUUID(),artifactHash,schemaVersion:"1.0",canonicalBody:{recipeKey:"catalog.category.assign.v1",compatibility:{adapter:"medusa-v2",capabilityContract:"1"}},idempotencyKey:randomUUID(),requestHash:artifactHash});
      await tx.createRequestAndJob({ id: requestId, actorId, redactedText: "request", contextRef: {}, budget: {}, jobId: randomUUID(), idempotencyKey: randomUUID(), requestHash: "3".repeat(64) });
      await tx.createPlan(testPlan({ requestId, actorId, tenantId, id: planId, planHash,artifactHash,idempotencyKey: randomUUID(), requestHash: "4".repeat(64) }));
    });
    return { requestId, planId, planHash,artifactHash };
  }

  async function seedHostSession(tenantId:string,actorId:string) {
    const sessionId=randomUUID();
    await store.withTenant({tenantId,actorId},(tx)=>tx.exchangeSessionTicket({ticketId:randomUUID(),issuer:"medusa-test",jtiHash:randomUUID().replaceAll("-","").padEnd(64,"0"),nonceHash:randomUUID().replaceAll("-", ""),audience:"changedesk",sessionId,policyVersion:"1",ticketExpiresAt:new Date(Date.now()+60_000),sessionExpiresAt:new Date(Date.now()+300_000)}));
    return sessionId;
  }
});

function testPlan(overrides: Record<string, unknown>) {
  return {
    id: randomUUID(), requestId: randomUUID(), actorId: "operator", artifactHash: "a".repeat(64), adapterVersion: "1",
    policyVersion: "1", capabilityManifestHash: "b".repeat(64), body: {}, planHash: "c".repeat(64), planVersion: 1,
    state: "ready" as const, expiresAt: new Date(Date.now() + 120_000), idempotencyKey: randomUUID(), requestHash: "5".repeat(64), ...overrides,
  };
}
