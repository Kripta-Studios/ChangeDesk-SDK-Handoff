import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  ApprovalRecord, AttemptIntent, AttemptRecord, AttemptState, CapabilityManifestRecord, CatalogArtifact, CatalogQuery, EffectClaimDecision, EvidenceRecord, ExecutionAdmission, ExecutionBundle, ExecutionRecord, GenerationBundle, InstallationRecord, JobLease,
  GenerationCallRecordResult, GenerationCallReservationInput, GenerationReservationInput, GenerationReservationResult, GenerationReservationToken, GenerationScope, GenerationUsage, InstallationDetailRecord, InstallationPlanContext, NewApproval, NewExecutionRow, NewPlan, NewRequest, PlanDetailRecord, PlanRecord, PublicationKey, PublicationRecord, RequestCandidateRecord, RequestMessageRecord, RequestRecord, RetentionResult, SessionRecord, TenantContext,
} from "./types.js";

export class StorageConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
  constructor() { super("Idempotency key was already used with a different request"); }
}

export class StorageInvariantError extends Error {
  readonly code = "STORAGE_INVARIANT_VIOLATION";
}
export class StorageCapacityError extends Error { readonly code="QUEUE_CAPACITY_EXCEEDED";constructor(readonly scope:"tenant"|"global"){super(`Pending job capacity exceeded for ${scope}`);} }

export class Store {
  constructor(private readonly pool: Pool) {}

  async withTenant<T>(context: TenantContext, work: (tx: TenantTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true)", [context.tenantId, context.actorId]);
      const result = await work(new TenantTx(client, context));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class TicketReplayStore {
  constructor(private readonly store:Store) {}
  consumeTicket(input:{tenantId:string;actorId:string;ticketId:string;issuer:string;jti:string;audience:string;expiresAt:Date}):Promise<boolean> {
    const jtiHash=createHash("sha256").update(input.jti,"utf8").digest("hex");
    return this.store.withTenant({tenantId:input.tenantId,actorId:input.actorId},(tx)=>tx.consumeTicket({...input,jtiHash,nonceHash:jtiHash}));
  }
}

export class TenantTx {
  constructor(private readonly client: PoolClient, private readonly context: TenantContext) {}

  async createRequestAndJob(input: NewRequest): Promise<RequestRecord> {
    const replay = await this.reserveIdempotency("requests.create", input.idempotencyKey, input.requestHash);
    if (replay) return this.requireRequest(replay);
    const row = one(await this.client.query<RequestRow>(
      `INSERT INTO storage.requests (tenant_id,id,actor_id,redacted_text,context_ref,state,budget)
       VALUES ($1,$2,$3,$4,$5,'received',$6)
       RETURNING id,actor_id,state,created_at`,
      [this.context.tenantId, input.id, input.actorId, input.redactedText, input.contextRef, input.budget],
    ));
    await this.enqueueJob({id:input.jobId,actorId:input.actorId,...(input.backendKey?{backendKey:input.backendKey}:{}),requestId:input.id,kind:"generation"});
    await this.client.query("SELECT storage.ensure_scheduler_tenant($1,COALESCE($2,(SELECT backend_key FROM storage.tenants WHERE id=$1)))", [this.context.tenantId,input.backendKey ?? null]);
    await this.bindIdempotency("requests.create", input.idempotencyKey, input.id);
    return requestRecord(row);
  }

  async createInstalledActionRequest(input:Omit<NewRequest,"jobId"|"backendKey">):Promise<RequestRecord> {
    const replay=await this.reserveIdempotency("requests.installed_action.create",input.idempotencyKey,input.requestHash);
    if(replay) return this.requireRequest(replay);
    const row=one(await this.client.query<RequestRow>(`INSERT INTO storage.requests(tenant_id,id,actor_id,redacted_text,context_ref,state,budget)
      VALUES($1,$2,$3,$4,$5,'received',$6) RETURNING id,actor_id,state,created_at`,
      [this.context.tenantId,input.id,input.actorId,input.redactedText,input.contextRef,input.budget]));
    await this.bindIdempotency("requests.installed_action.create",input.idempotencyKey,input.id);
    return requestRecord(row);
  }

  async setCapabilityManifest(input:{id:string;manifestHash:string;adapterVersion:string;body:unknown;idempotencyKey:string;requestHash:string}):Promise<void> {
    const replay=await this.reserveIdempotency("capability_manifests.activate",input.idempotencyKey,input.requestHash);
    if(replay) return;
    await this.client.query("UPDATE storage.capability_manifests SET active=false WHERE tenant_id=$1 AND active",[this.context.tenantId]);
    const row=one(await this.client.query<{id:string}>(`INSERT INTO storage.capability_manifests
      (tenant_id,id,manifest_hash,adapter_version,body,active) VALUES($1,$2,$3,$4,$5,true)
      ON CONFLICT (tenant_id,manifest_hash) DO UPDATE SET active=true RETURNING id`,
      [this.context.tenantId,input.id,input.manifestHash,input.adapterVersion,input.body]));
    await this.bindIdempotency("capability_manifests.activate",input.idempotencyKey,row.id);
  }

  async loadGenerationBundle(lease:JobLease):Promise<GenerationBundle|null> {
    const result=await this.client.query<GenerationBundleRow>(`SELECT r.id,r.actor_id,r.redacted_text,r.context_ref,r.budget,r.state,r.created_at,
      t.policy_version,t.backend_key,ac.role actor_role,ac.state actor_state,m.id manifest_id,m.manifest_hash,m.adapter_version,m.body manifest_body
      FROM storage.jobs j JOIN storage.requests r ON r.tenant_id=j.tenant_id AND r.id=j.request_id
      JOIN storage.tenants t ON t.id=j.tenant_id
      JOIN storage.actors ac ON ac.tenant_id=j.tenant_id AND ac.actor_id=j.actor_id
      JOIN storage.capability_manifests m ON m.tenant_id=j.tenant_id AND m.active
      WHERE j.id=$1 AND j.tenant_id=$2 AND j.actor_id=$3 AND j.kind='generation' AND j.status='leased'
        AND j.lease_owner=$4 AND j.fence=$5 AND j.lease_until>clock_timestamp()`,
      [lease.jobId,this.context.tenantId,this.context.actorId,lease.leaseOwner,lease.fence]);
    if(result.rowCount!==1) return null;
    const row=result.rows[0]!;
    return {
      request:{id:row.id,actorId:row.actor_id,redactedText:row.redacted_text,contextRef:row.context_ref,budget:row.budget,state:row.state,createdAt:row.created_at},
      tenant:{policyVersion:row.policy_version,backendKey:row.backend_key},
      actor:{role:row.actor_role,enabled:row.actor_state==="enabled"},
      capabilityManifest:{id:row.manifest_id,manifestHash:row.manifest_hash,adapterVersion:row.adapter_version,body:row.manifest_body},
    };
  }

  async getActiveCapabilityManifest():Promise<CapabilityManifestRecord|null> {
    const result=await this.client.query<{id:string;manifest_hash:string;adapter_version:string;body:CapabilityManifestRecord["body"]}>(
      "SELECT id,manifest_hash,adapter_version,body FROM storage.capability_manifests WHERE tenant_id=$1 AND active",[this.context.tenantId]);
    if(result.rowCount!==1) return null;
    const row=result.rows[0]!;
    return {id:row.id,manifestHash:row.manifest_hash,adapterVersion:row.adapter_version,body:row.body};
  }

  async reserveGeneration(input:GenerationReservationInput):Promise<GenerationReservationResult> {
    if(input.maxAttempts<1 || input.maxAttempts>3 || input.tokenBudget<0n || input.costBudgetMicros<0n) throw new StorageInvariantError("Invalid generation budget");
    await this.client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`generation:${this.context.tenantId}:${input.intentHash}:${input.contractVersion}`]);
    const existing=await this.client.query<GenerationReservationRow>(`SELECT id,status,fence,attempt_count,max_attempts,artifact_id,retryable
      FROM storage.generation_reservations WHERE tenant_id=$1 AND intent_hash=$2 AND contract_version=$3 FOR UPDATE`,
      [this.context.tenantId,input.intentHash,input.contractVersion]);
    if(existing.rowCount===1) {
      const row=existing.rows[0]!;
      if(row.status==="failed" && row.retryable && row.attempt_count<row.max_attempts) {
        const acquired=one(await this.client.query<GenerationReservationRow>(`UPDATE storage.generation_reservations
          SET status='running',fence=fence+1,attempt_count=attempt_count+1,retryable=false,lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp()
          WHERE tenant_id=$1 AND id=$2 RETURNING id,status,fence,attempt_count,max_attempts,artifact_id,retryable`,[this.context.tenantId,row.id]));
        return {state:"acquired",id:acquired.id,fence:Number(acquired.fence),attempt:acquired.attempt_count};
      }
      if(row.status==="failed") return {state:"exhausted"};
      return {state:"existing",id:row.id,status:row.status,...(row.artifact_id?{artifactId:row.artifact_id}:{})};
    }
    const created=one(await this.client.query<GenerationReservationRow>(`INSERT INTO storage.generation_reservations
      (tenant_id,id,actor_id,request_id,intent_hash,contract_version,provider,model,status,max_attempts,token_budget,cost_budget_micros,reserved_cost_micros,lease_owner,lease_until)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'running',$9,$10,$11,$11,$2,clock_timestamp()+interval '5 minutes')
      RETURNING id,status,fence,attempt_count,max_attempts,artifact_id,retryable`,
      [this.context.tenantId,input.id,input.actorId,input.requestId,input.intentHash,input.contractVersion,input.provider,input.model,input.maxAttempts,input.tokenBudget.toString(),input.costBudgetMicros.toString()]));
    await this.incrementUsage({generationCalls:1n});
    return {state:"acquired",id:created.id,fence:Number(created.fence),attempt:created.attempt_count};
  }

  async completeGeneration(id:string,fence:number,usage:GenerationUsage):Promise<boolean>;
  async completeGeneration(scope:GenerationScope,token:GenerationReservationToken,input:{artifactId:string}):Promise<boolean>;
  async completeGeneration(idOrScope:string|GenerationScope,fenceOrToken:number|GenerationReservationToken,usage:{artifactId:string;usedTokens?:bigint;usedCostMicros?:bigint}):Promise<boolean> {
    if(typeof idOrScope!=="string") return this.completeGenerationCall(idOrScope,fenceOrToken as GenerationReservationToken,{artifactId:usage.artifactId});
    const result=await this.client.query(`UPDATE storage.generation_reservations SET status='completed',artifact_id=$4,used_tokens=$5,used_cost_micros=$6,
      reserved_cost_micros=0,lease_owner=NULL,lease_until=NULL,retryable=false,updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND id=$2 AND fence=$3 AND status='running'`,[this.context.tenantId,idOrScope,fenceOrToken,usage.artifactId,(usage.usedTokens ?? 0n).toString(),(usage.usedCostMicros ?? 0n).toString()]);
    if(result.rowCount===1) await this.incrementUsage({inputTokens:usage.usedTokens ?? 0n,estimatedCostMicros:usage.usedCostMicros ?? 0n});
    return result.rowCount===1;
  }

  async failGeneration(id:string,fence:number,usage:Omit<GenerationUsage,"artifactId">&{retryable:boolean}):Promise<boolean>;
  async failGeneration(scope:GenerationScope,token:GenerationReservationToken,input:{retryable:boolean}):Promise<boolean>;
  async failGeneration(idOrScope:string|GenerationScope,fenceOrToken:number|GenerationReservationToken,usage:{usedTokens?:bigint;usedCostMicros?:bigint;retryable:boolean}):Promise<boolean> {
    if(typeof idOrScope!=="string") return this.failGenerationCall(idOrScope,fenceOrToken as GenerationReservationToken,{retryable:usage.retryable});
    const result=await this.client.query(`UPDATE storage.generation_reservations SET status='failed',used_tokens=$4,used_cost_micros=$5,
      reserved_cost_micros=0,lease_owner=NULL,lease_until=NULL,retryable=$6,updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND id=$2 AND fence=$3 AND status='running'`,[this.context.tenantId,idOrScope,fenceOrToken,(usage.usedTokens ?? 0n).toString(),(usage.usedCostMicros ?? 0n).toString(),usage.retryable]);
    if(result.rowCount===1) await this.incrementUsage({inputTokens:usage.usedTokens ?? 0n,estimatedCostMicros:usage.usedCostMicros ?? 0n});
    return result.rowCount===1;
  }

  async reserveGenerationCall(input:GenerationCallReservationInput):Promise<{reservationId:string;fence:bigint;attempt:number}|null> {
    this.assertGenerationScope(input);
    if(input.leaseSeconds<1 || input.leaseSeconds>300 || input.tokenBudget<0n || input.costBudgetMicros<0n) throw new StorageInvariantError("Invalid generation reservation");
    await this.client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`generation-call:${input.tenantId}:${input.intentHash}:${input.contractVersion}`]);
    const existing=await this.client.query<GenerationReservationRow>(`SELECT id,status,fence,attempt_count,max_attempts,artifact_id,retryable,lease_until
      FROM storage.generation_reservations WHERE tenant_id=$1 AND intent_hash=$2 AND contract_version=$3 FOR UPDATE`,[input.tenantId,input.intentHash,input.contractVersion]);
    if(existing.rowCount===1) {
      const row=existing.rows[0]!;
      const reclaimable=row.status==="pending" || (row.status==="running" && row.lease_until!==null && row.lease_until<=new Date());
      if(!reclaimable || row.attempt_count>=row.max_attempts) return null;
      const claimed=one(await this.client.query<GenerationReservationRow>(`UPDATE storage.generation_reservations SET status='running',fence=fence+1,
        attempt_count=attempt_count+1,lease_owner=$3,lease_until=clock_timestamp()+make_interval(secs=>$4),retryable=false,updated_at=clock_timestamp()
        WHERE tenant_id=$1 AND id=$2 RETURNING id,status,fence,attempt_count,max_attempts,artifact_id,retryable,lease_until`,
        [input.tenantId,row.id,input.leaseOwner,input.leaseSeconds]));
      await this.incrementUsage({generationCalls:1n});
      return {reservationId:claimed.id,fence:BigInt(claimed.fence),attempt:claimed.attempt_count};
    }
    const id=randomUUID();
    const created=one(await this.client.query<GenerationReservationRow>(`INSERT INTO storage.generation_reservations
      (tenant_id,id,actor_id,request_id,intent_hash,contract_version,provider,model,status,max_attempts,token_budget,cost_budget_micros,reserved_cost_micros,lease_owner,lease_until)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'running',$9,$10,$11,$11,$12,clock_timestamp()+make_interval(secs=>$13))
      RETURNING id,status,fence,attempt_count,max_attempts,artifact_id,retryable,lease_until`,[input.tenantId,id,input.actorId,input.requestId,input.intentHash,input.contractVersion,
        input.provider,input.model,input.maxAttempts,input.tokenBudget.toString(),input.costBudgetMicros.toString(),input.leaseOwner,input.leaseSeconds]));
    await this.incrementUsage({generationCalls:1n});
    return {reservationId:created.id,fence:BigInt(created.fence),attempt:created.attempt_count};
  }

  reserveCall(input:GenerationCallReservationInput):Promise<{reservationId:string;fence:bigint;attempt:number}|null> { return this.reserveGenerationCall(input); }

  async recordGenerationCall(scope:GenerationScope,token:GenerationReservationToken,input:{inputTokens:bigint;outputTokens:bigint;usedCostMicros:bigint;retryable:boolean;success:boolean}):Promise<GenerationCallRecordResult> {
    this.assertGenerationScope(scope);
    if(input.inputTokens<0n || input.outputTokens<0n || input.usedCostMicros<0n) throw new StorageInvariantError("Invalid generation usage");
    const result=await this.client.query<{within_budget:boolean}>(`UPDATE storage.generation_reservations SET used_tokens=used_tokens+$4+$5,used_cost_micros=used_cost_micros+$6,
      status=CASE WHEN used_tokens+$4+$5>token_budget OR used_cost_micros+$6>cost_budget_micros THEN 'failed'
        WHEN $8 THEN 'running' WHEN $7 AND attempt_count<max_attempts THEN 'pending' ELSE 'failed' END,
      retryable=CASE WHEN used_tokens+$4+$5>token_budget OR used_cost_micros+$6>cost_budget_micros THEN false
        ELSE NOT $8 AND $7 AND attempt_count<max_attempts END,
      lease_owner=CASE WHEN $8 AND used_tokens+$4+$5<=token_budget AND used_cost_micros+$6<=cost_budget_micros THEN lease_owner ELSE NULL END,
      lease_until=CASE WHEN $8 AND used_tokens+$4+$5<=token_budget AND used_cost_micros+$6<=cost_budget_micros THEN lease_until ELSE NULL END,updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND actor_id=$2 AND id=$3 AND fence=$9 AND status='running'
      RETURNING used_tokens<=token_budget AND used_cost_micros<=cost_budget_micros within_budget`,[scope.tenantId,scope.actorId,token.reservationId,
      input.inputTokens.toString(),input.outputTokens.toString(),input.usedCostMicros.toString(),input.retryable,input.success,token.fence.toString()]);
    if(result.rowCount===1) await this.incrementUsage({inputTokens:input.inputTokens,outputTokens:input.outputTokens,estimatedCostMicros:input.usedCostMicros});
    return {recorded:result.rowCount===1,withinBudget:result.rows[0]?.within_budget===true};
  }

  recordCall(scope:GenerationScope,token:GenerationReservationToken,input:{inputTokens:bigint;outputTokens:bigint;usedCostMicros:bigint;retryable:boolean;success:boolean}):Promise<GenerationCallRecordResult> {
    return this.recordGenerationCall(scope,token,input);
  }

  async completeGenerationCall(scope:GenerationScope,token:GenerationReservationToken,input:{artifactId:string}):Promise<boolean> {
    this.assertGenerationScope(scope);
    const result=await this.client.query(`UPDATE storage.generation_reservations SET status='completed',artifact_id=$5,reserved_cost_micros=0,
      lease_owner=NULL,lease_until=NULL,retryable=false,updated_at=clock_timestamp() WHERE tenant_id=$1 AND actor_id=$2 AND id=$3 AND fence=$4 AND status='running'`,
      [scope.tenantId,scope.actorId,token.reservationId,token.fence.toString(),input.artifactId]);
    return result.rowCount===1;
  }

  async failGenerationCall(scope:GenerationScope,token:GenerationReservationToken,input:{retryable:boolean}):Promise<boolean> {
    this.assertGenerationScope(scope);
    const result=await this.client.query(`UPDATE storage.generation_reservations SET status=CASE WHEN $5 AND attempt_count<max_attempts THEN 'pending' ELSE 'failed' END,
      retryable=$5 AND attempt_count<max_attempts,reserved_cost_micros=0,lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND actor_id=$2 AND id=$3 AND fence=$4 AND status='running'`,[scope.tenantId,scope.actorId,token.reservationId,token.fence.toString(),input.retryable]);
    return result.rowCount===1;
  }

  async cleanupRetention(now:Date):Promise<RetentionResult> {
    const row=one(await this.client.query<{result:{requestsCleaned:number;attemptsCleaned:number;usageDeleted:number} }>("SELECT storage.cleanup_tenant_retention($1) result",[now]));
    return row.result;
  }

  async tombstoneTenant(reasonCode:string):Promise<void> { await this.client.query("SELECT storage.tombstone_current_tenant($1)",[reasonCode]); }

  async listRequests(): Promise<RequestRecord[]> {
    const result = await this.client.query<RequestRow>("SELECT id,actor_id,state,created_at FROM storage.requests ORDER BY created_at,id");
    return result.rows.map(requestRecord);
  }

  async getRequest(id:string):Promise<RequestRecord|null> {
    const result=await this.client.query<RequestRow>("SELECT id,actor_id,state,created_at FROM storage.requests WHERE tenant_id=$1 AND id=$2",[this.context.tenantId,id]);
    return result.rowCount===1?requestRecord(result.rows[0]!):null;
  }

  async addRequestMessage(input:{id:string;requestId:string;clientRequestId:string;redactedText:string}):Promise<RequestMessageRecord> {
    const result=await this.client.query<MessageRow>(`INSERT INTO storage.request_messages
      (tenant_id,request_id,id,actor_id,client_request_id,redacted_text) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT (tenant_id,actor_id,client_request_id) DO UPDATE SET client_request_id=EXCLUDED.client_request_id
      RETURNING id,request_id,actor_id,client_request_id,redacted_text,created_at`,
      [this.context.tenantId,input.requestId,input.id,this.context.actorId,input.clientRequestId,input.redactedText]);
    return messageRecord(one(result));
  }

  async updateRequestState(id:string,state:"received"|"searching"|"candidate_offered"|"generating"|"needs_configuration"|"needs_clarification"|"plan_ready"|"rejected"|"error"):Promise<boolean> {
    const result=await this.client.query("UPDATE storage.requests SET state=$3,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2",[this.context.tenantId,id,state]);
    return result.rowCount===1;
  }

  async updateRequestWithLease(lease:JobLease,requestId:string,state:RequestRecord["state"]):Promise<boolean> {
    const result=await this.client.query(`UPDATE storage.requests r SET state=$6,updated_at=clock_timestamp()
      FROM storage.jobs j WHERE r.tenant_id=$1 AND r.id=$2 AND j.id=$3 AND j.tenant_id=$1 AND j.request_id=r.id
        AND j.lease_owner=$4 AND j.fence=$5 AND j.status='leased'`,
      [this.context.tenantId,requestId,lease.jobId,lease.leaseOwner,lease.fence,state]);
    return result.rowCount===1;
  }

  async addRequestCandidates(lease:JobLease,requestId:string,candidates:readonly Omit<RequestCandidateRecord,"requestId"|"state"|"selectedChoice">[]):Promise<boolean> {
    const result=await this.client.query<{valid:boolean}>(`WITH valid AS(
      SELECT 1 FROM storage.jobs j WHERE j.id=$1 AND j.tenant_id=$2 AND j.request_id=$3 AND j.kind='generation'
        AND j.status='leased' AND j.lease_owner=$4 AND j.fence=$5 AND j.lease_until>clock_timestamp()
    ), input AS(
      SELECT * FROM jsonb_to_recordset($6::jsonb) AS c(id text,version text,artifact_hash text,recipe_key text,display_name text,
        required_capabilities jsonb,compatibility text,evidence_status text,estimated_cost jsonb,safe_metadata jsonb)
    ), inserted AS(
      INSERT INTO storage.request_candidates(tenant_id,request_id,id,version,artifact_hash,recipe_key,display_name,required_capabilities,
        compatibility,evidence_status,estimated_cost,safe_metadata)
      SELECT $2,$3,c.id,c.version,c.artifact_hash,c.recipe_key,c.display_name,c.required_capabilities,c.compatibility,c.evidence_status,c.estimated_cost,c.safe_metadata
      FROM input c,valid ON CONFLICT(tenant_id,request_id,id,version) DO NOTHING RETURNING 1
    ) SELECT EXISTS(SELECT 1 FROM valid) valid`,[lease.jobId,this.context.tenantId,requestId,lease.leaseOwner,lease.fence,JSON.stringify(candidates.map(candidateDbInput))]);
    return result.rows[0]?.valid===true;
  }

  async persistGeneratedCandidate(lease:JobLease,input:{requestId:string;artifact:{id:string;artifactHash:string;schemaVersion:string;canonicalBody:unknown};candidate:Omit<RequestCandidateRecord,"requestId"|"state"|"selectedChoice">;generationToken?:GenerationReservationToken}):Promise<boolean> {
    const valid=await this.client.query(`SELECT 1 FROM storage.jobs j WHERE j.id=$1 AND j.tenant_id=$2 AND j.actor_id=$3 AND j.request_id=$4
      AND j.kind='generation' AND j.status='leased' AND j.lease_owner=$5 AND j.fence=$6 AND j.lease_until>clock_timestamp() FOR UPDATE`,
      [lease.jobId,this.context.tenantId,this.context.actorId,input.requestId,lease.leaseOwner,lease.fence]);
    if(valid.rowCount!==1) return false;
    await this.client.query(`INSERT INTO storage.recipe_artifacts(id,owner_tenant_id,artifact_hash,schema_version,canonical_body,state)
      VALUES($1,$2,$3,$4,$5,'private') ON CONFLICT(owner_tenant_id,artifact_hash) WHERE owner_tenant_id IS NOT NULL DO NOTHING`,
      [input.artifact.id,this.context.tenantId,input.artifact.artifactHash,input.artifact.schemaVersion,input.artifact.canonicalBody]);
    const owned=one(await this.client.query<{id:string;schema_version:string;canonical_body:unknown}>(`SELECT id,schema_version,canonical_body FROM storage.recipe_artifacts
      WHERE owner_tenant_id=$1 AND artifact_hash=$2 FOR SHARE`,[this.context.tenantId,input.artifact.artifactHash]));
    if(owned.schema_version!==input.artifact.schemaVersion || stableJson(owned.canonical_body)!==stableJson(input.artifact.canonicalBody)) {
      throw new StorageInvariantError("Artifact digest resolved to different canonical content");
    }
    const candidate=candidateDbInput(input.candidate);
    await this.client.query(`INSERT INTO storage.request_candidates(tenant_id,request_id,id,version,artifact_hash,recipe_key,display_name,required_capabilities,
      compatibility,evidence_status,estimated_cost,safe_metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12::jsonb)
      ON CONFLICT(tenant_id,request_id,id,version) DO NOTHING`,[this.context.tenantId,input.requestId,candidate.id,candidate.version,
      candidate.artifact_hash,candidate.recipe_key,candidate.display_name,JSON.stringify(candidate.required_capabilities),candidate.compatibility,candidate.evidence_status,JSON.stringify(candidate.estimated_cost),JSON.stringify(candidate.safe_metadata)]);
    if(input.generationToken) {
      const completed=await this.completeGenerationCall(this.context,input.generationToken,{artifactId:owned.id});
      if(!completed) throw new StorageInvariantError("Generation reservation fence is stale");
    }
    const stillValid=await this.client.query(`SELECT 1 FROM storage.jobs WHERE id=$1 AND lease_owner=$2 AND fence=$3 AND lease_until>clock_timestamp()`,[lease.jobId,lease.leaseOwner,lease.fence]);
    if(stillValid.rowCount!==1) throw new StorageInvariantError("Generation lease expired while persisting candidate");
    return true;
  }

  async listRequestCandidates(requestId:string):Promise<RequestCandidateRecord[]> {
    const result=await this.client.query<CandidateRow>(`SELECT id,request_id,version,artifact_hash,recipe_key,display_name,required_capabilities,
      compatibility,evidence_status,estimated_cost,safe_metadata,state,selected_choice FROM storage.request_candidates
      WHERE tenant_id=$1 AND request_id=$2 ORDER BY created_at,id`,[this.context.tenantId,requestId]);
    return result.rows.map(candidateRecord);
  }

  async selectRequestCandidate(input:{requestId:string;candidateId:string;version:string;choice:"reuse"|"adapt";idempotencyKey:string;requestHash:string}):Promise<RequestCandidateRecord|null> {
    const replay=await this.reserveIdempotency("requests.candidate.select",input.idempotencyKey,input.requestHash);
    if(replay) {
      const rows=await this.listRequestCandidates(input.requestId);
      return rows.find(candidate=>candidate.id===replay && candidate.version===input.version) ?? null;
    }
    await this.client.query("UPDATE storage.request_candidates SET state='offered',selected_choice=NULL,selected_at=NULL WHERE tenant_id=$1 AND request_id=$2 AND state='selected'",[this.context.tenantId,input.requestId]);
    const result=await this.client.query<CandidateRow>(`UPDATE storage.request_candidates SET state='selected',selected_choice=$5,selected_at=clock_timestamp()
      WHERE tenant_id=$1 AND request_id=$2 AND id=$3 AND version=$4 AND compatibility<>'incompatible'
      RETURNING id,request_id,version,artifact_hash,recipe_key,display_name,required_capabilities,compatibility,evidence_status,estimated_cost,safe_metadata,state,selected_choice`,
      [this.context.tenantId,input.requestId,input.candidateId,input.version,input.choice]);
    if(result.rowCount!==1) return null;
    await this.bindIdempotency("requests.candidate.select",input.idempotencyKey,input.candidateId);
    return candidateRecord(result.rows[0]!);
  }

  async createPlan(input: NewPlan): Promise<PlanRecord> {
    const replay = await this.reserveIdempotency("plans.create", input.idempotencyKey, input.requestHash);
    if (replay) return this.requirePlan(replay);
    const row = one(await this.client.query<PlanRow>(
      `INSERT INTO storage.plans (tenant_id,id,request_id,installation_id,actor_id,artifact_hash,adapter_version,
        policy_version,capability_manifest_hash,body,plan_hash,plan_version,state,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id,actor_id,plan_version,plan_hash,state,expires_at`,
      [this.context.tenantId,input.id,input.requestId,input.installationId ?? null,input.actorId,input.artifactHash,
        input.adapterVersion,input.policyVersion,input.capabilityManifestHash,input.body,input.planHash,input.planVersion,input.state,input.expiresAt],
    ));
    await this.bindIdempotency("plans.create", input.idempotencyKey, input.id);
    return planRecord(row);
  }

  async createApproval(input: NewApproval): Promise<ApprovalRecord> {
    const replay = await this.reserveIdempotency("approvals.create", input.idempotencyKey, input.requestHash);
    if (replay) return this.requireApproval(replay);
    const result = await this.client.query<ApprovalRow>(
      `INSERT INTO storage.approvals (tenant_id,id,plan_id,plan_version,plan_hash,actor_id,host_session_id,scope,expires_at)
       SELECT $1,$2,p.id,p.plan_version,p.plan_hash,$3,$4,$5,$6 FROM storage.plans p
       JOIN storage.sessions s ON s.tenant_id=p.tenant_id AND s.id=$4 AND s.actor_id=$3 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
       WHERE p.tenant_id=$1 AND p.id=$7 AND p.plan_version=$8 AND p.plan_hash=$9 AND p.actor_id=$3
         AND p.state='ready' AND p.expires_at > clock_timestamp()
       ON CONFLICT (tenant_id,plan_id,plan_version,actor_id) DO UPDATE SET plan_hash=EXCLUDED.plan_hash
       RETURNING id,plan_id,plan_version,plan_hash,actor_id,host_session_id,expires_at,consumed_execution_id`,
      [this.context.tenantId,input.id,input.actorId,input.hostSessionId,[...input.scope],input.expiresAt,input.planId,input.planVersion,input.planHash],
    );
    if (result.rowCount !== 1) throw new StorageInvariantError("Plan is stale, expired, mismatched, or not owned by the actor");
    const row = one(result);
    await this.bindIdempotency("approvals.create", input.idempotencyKey, row.id);
    return approvalRecord(row);
  }

  async getPlan(id:string):Promise<PlanRecord|null> {
    const result=await this.client.query<PlanRow>("SELECT id,actor_id,plan_version,plan_hash,state,expires_at FROM storage.plans WHERE tenant_id=$1 AND id=$2",[this.context.tenantId,id]);
    return result.rowCount===1?planRecord(result.rows[0]!):null;
  }

  async getPlanDetail(id:string):Promise<PlanDetailRecord|null> {
    const result=await this.client.query<PlanDetailRow>(`SELECT id,request_id,installation_id,actor_id,artifact_hash,adapter_version,policy_version,
      capability_manifest_hash,body,plan_hash,plan_version,state,expires_at,created_at FROM storage.plans WHERE tenant_id=$1 AND id=$2`,[this.context.tenantId,id]);
    if(result.rowCount!==1) return null;
    const row=result.rows[0]!;
    return {...planRecord(row),requestId:row.request_id,installationId:row.installation_id,artifactHash:row.artifact_hash,adapterVersion:row.adapter_version,
      policyVersion:row.policy_version,capabilityManifestHash:row.capability_manifest_hash,body:jsonRecord(row.body) as PlanDetailRecord["body"],createdAt:row.created_at};
  }

  async admitExecution(input: ExecutionAdmission): Promise<ExecutionRecord> {
    const replay = await this.reserveIdempotency("executions.create", input.idempotencyKey, input.requestHash);
    if (replay) return this.requireExecution(replay);
    const authority=await this.client.query<AdmissionRow>(
      `SELECT a.plan_id,a.plan_version,a.id approval_id,a.actor_id,
        (a.consumed_execution_id IS NULL AND a.expires_at>clock_timestamp() AND p.expires_at>clock_timestamp() AND p.state='ready') authorized
       FROM storage.approvals a JOIN storage.plans p ON p.tenant_id=a.tenant_id AND p.id=a.plan_id AND p.plan_version=a.plan_version
       WHERE a.tenant_id=$1 AND a.id=$2 AND a.actor_id=$3 FOR UPDATE OF a`,
      [this.context.tenantId,input.approvalId,input.actorId],
    );
    if(authority.rowCount!==1) throw new StorageInvariantError("Approval cannot admit an execution");
    const approved=authority.rows[0]!;
    const existing=await this.client.query<ExecutionRow>(
      `SELECT id,plan_id,plan_version,approval_id,actor_id,prior_execution_id,state,revision FROM storage.executions
       WHERE tenant_id=$1 AND plan_id=$2 AND plan_version=$3`,[this.context.tenantId,approved.plan_id,approved.plan_version],
    );
    if(existing.rowCount===1) {
      await this.bindIdempotency("executions.create",input.idempotencyKey,existing.rows[0]!.id);
      return executionRecord(existing.rows[0]!);
    }
    if(!approved.authorized) throw new StorageInvariantError("Approval cannot admit an execution");
    const row=one(await this.client.query<ExecutionRow>(
      `INSERT INTO storage.executions (tenant_id,id,plan_id,plan_version,approval_id,actor_id,prior_execution_id,state,deadline_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8)
       RETURNING id,plan_id,plan_version,approval_id,actor_id,prior_execution_id,state,revision`,
      [this.context.tenantId,input.id,approved.plan_id,approved.plan_version,approved.approval_id,approved.actor_id,input.priorExecutionId ?? null,input.deadlineAt ?? null],
    ));
    await this.client.query(
      "UPDATE storage.approvals SET consumed_execution_id=$3 WHERE tenant_id=$1 AND id=$2 AND consumed_execution_id IS NULL",
      [this.context.tenantId,row.approval_id,row.id],
    );
    await this.enqueueJob({id:input.jobId,actorId:input.actorId,...(input.backendKey?{backendKey:input.backendKey}:{}),executionId:row.id,kind:"execution"});
    await this.client.query("SELECT storage.ensure_scheduler_tenant($1,COALESCE($2,(SELECT backend_key FROM storage.tenants WHERE id=$1)))", [this.context.tenantId,input.backendKey ?? null]);
    await this.bindIdempotency("executions.create", input.idempotencyKey, row.id);
    return executionRecord(row);
  }

  async loadExecutionBundle(executionId: string): Promise<ExecutionBundle | null> {
    const head = await this.client.query<BundleRow>(
      `SELECT row_to_json(e) execution,row_to_json(p) plan,row_to_json(a) approval,row_to_json(i) installation,
        row_to_json(ra) artifact,row_to_json(ac) actor,a.host_session_id
       FROM storage.executions e
       JOIN storage.plans p ON p.tenant_id=e.tenant_id AND p.id=e.plan_id AND p.plan_version=e.plan_version
       JOIN storage.approvals a ON a.tenant_id=e.tenant_id AND a.id=e.approval_id
       JOIN storage.actors ac ON ac.tenant_id=e.tenant_id AND ac.actor_id=e.actor_id
       LEFT JOIN storage.installations i ON i.tenant_id=p.tenant_id AND i.id=p.installation_id
       LEFT JOIN storage.recipe_artifacts ra ON (
         (p.installation_id IS NULL AND ra.owner_tenant_id=p.tenant_id AND ra.artifact_hash=p.artifact_hash)
         OR (p.installation_id IS NOT NULL AND ra.id=i.artifact_id)
       )
       WHERE e.tenant_id=$1 AND e.id=$2`, [this.context.tenantId, executionId],
    );
    if (head.rowCount !== 1) return null;
    const bundle:BundleRow=one(head);
    bundle.plan.body=jsonRecord(bundle.plan.body);
    const [rows, attempts] = await Promise.all([
      this.client.query("SELECT * FROM storage.execution_rows WHERE tenant_id=$1 AND execution_id=$2 ORDER BY row_id", [this.context.tenantId,executionId]),
      this.client.query("SELECT * FROM storage.step_attempts WHERE tenant_id=$1 AND execution_id=$2 ORDER BY row_id,step_id,attempt_no", [this.context.tenantId,executionId]),
    ]);
    return { ...bundle, rows: rows.rows, attempts: attempts.rows, authority:{hostSessionId:bundle.host_session_id} };
  }

  getExecutionDetail(executionId:string):Promise<ExecutionBundle|null> { return this.loadExecutionBundle(executionId); }

  async getExecution(id:string):Promise<ExecutionRecord|null> {
    const result=await this.client.query<ExecutionRow>("SELECT id,plan_id,plan_version,approval_id,actor_id,prior_execution_id,state,revision FROM storage.executions WHERE tenant_id=$1 AND id=$2",[this.context.tenantId,id]);
    return result.rowCount===1?executionRecord(result.rows[0]!):null;
  }

  async cancelExecution(id:string,control:{idempotencyKey:string;requestHash:string}):Promise<ExecutionRecord|null> {
    const replay=await this.reserveIdempotency("executions.cancel",control.idempotencyKey,control.requestHash);
    if(replay) return this.getExecution(replay);
    const result=await this.client.query<ExecutionRow>(`UPDATE storage.executions SET cancel_requested_at=COALESCE(cancel_requested_at,clock_timestamp()),revision=revision+1,updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND id=$2 AND state NOT IN ('succeeded','partial','failed','cancelled')
      RETURNING id,plan_id,plan_version,approval_id,actor_id,prior_execution_id,state,revision`,[this.context.tenantId,id]);
    if(result.rowCount!==1) return this.getExecution(id);
    await this.bindIdempotency("executions.cancel",control.idempotencyKey,id);
    return executionRecord(result.rows[0]!);
  }

  async enqueueReconciliation(input:{executionId:string;jobId:string;backendKey?:string;idempotencyKey:string;requestHash:string}):Promise<ExecutionRecord|null> {
    const replay=await this.reserveIdempotency("executions.resume",input.idempotencyKey,input.requestHash);
    if(replay) return this.getExecution(replay);
    const execution=await this.getExecution(input.executionId);
    if(!execution) return null;
    await this.enqueueJob({id:input.jobId,actorId:this.context.actorId,...(input.backendKey?{backendKey:input.backendKey}:{}),executionId:input.executionId,kind:"reconcile"});
    await this.client.query("SELECT storage.ensure_scheduler_tenant($1,COALESCE($2,(SELECT backend_key FROM storage.tenants WHERE id=$1)))",[this.context.tenantId,input.backendKey ?? null]);
    await this.bindIdempotency("executions.resume",input.idempotencyKey,input.executionId);
    return execution;
  }

  async insertExecutionRows(lease:JobLease,executionId:string,rows:readonly NewExecutionRow[]):Promise<boolean> {
    const result=await this.client.query<{valid:boolean}>(`WITH valid AS (
      SELECT 1 FROM storage.jobs j WHERE j.id=$1 AND j.tenant_id=$2 AND j.execution_id=$3 AND j.status='leased' AND j.lease_owner=$4 AND j.fence=$5 AND j.lease_until>clock_timestamp()
    ), input AS (
      SELECT * FROM jsonb_to_recordset($6::jsonb) AS r(row_id text,resource_ref text,precondition_fingerprint text)
    ), inserted AS (
      INSERT INTO storage.execution_rows(tenant_id,execution_id,row_id,resource_ref,state,precondition_fingerprint)
      SELECT $2,$3,i.row_id,i.resource_ref,'pending',i.precondition_fingerprint FROM input i,valid
      ON CONFLICT (tenant_id,execution_id,row_id) DO NOTHING RETURNING 1
    ) SELECT EXISTS(SELECT 1 FROM valid) valid`,
      [lease.jobId,this.context.tenantId,executionId,lease.leaseOwner,lease.fence,JSON.stringify(rows.map((row)=>({row_id:row.rowId,resource_ref:row.resourceRef,precondition_fingerprint:row.preconditionFingerprint})))]);
    return result.rows[0]?.valid===true;
  }

  async updateExecutionWithLease(lease:JobLease,executionId:string,state:ExecutionRecord["state"],expectedRevision:number):Promise<ExecutionRecord|null> {
    const result=await this.client.query<ExecutionRow>(`UPDATE storage.executions e SET state=$6,revision=e.revision+1,updated_at=clock_timestamp()
      FROM storage.jobs j WHERE e.tenant_id=$1 AND e.id=$2 AND e.revision=$7 AND j.id=$3 AND j.tenant_id=$1 AND j.execution_id=e.id
        AND j.lease_owner=$4 AND j.fence=$5 AND j.status='leased' AND j.lease_until>clock_timestamp()
      RETURNING e.id,e.plan_id,e.plan_version,e.approval_id,e.actor_id,e.prior_execution_id,e.state,e.revision`,
      [this.context.tenantId,executionId,lease.jobId,lease.leaseOwner,lease.fence,state,expectedRevision]);
    return result.rowCount===1?executionRecord(result.rows[0]!):null;
  }

  async updateRowWithLease(lease:JobLease,input:{executionId:string;rowId:string;state:"pending"|"running"|"succeeded"|"skipped"|"unknown"|"failed"|"needs_review";finalObservationRef?:string}):Promise<boolean> {
    const result=await this.client.query(`UPDATE storage.execution_rows r SET state=$6,final_observation_ref=COALESCE($7,final_observation_ref)
      FROM storage.jobs j WHERE r.tenant_id=$1 AND r.execution_id=$2 AND r.row_id=$3 AND j.id=$4 AND j.tenant_id=$1
        AND j.execution_id=r.execution_id AND j.lease_owner=$5 AND j.fence=$8 AND j.status='leased' AND j.lease_until>clock_timestamp()`,
      [this.context.tenantId,input.executionId,input.rowId,lease.jobId,lease.leaseOwner,input.state,input.finalObservationRef ?? null,lease.fence]);
    return result.rowCount===1;
  }

  async listDiscoverableCatalog(query:CatalogQuery):Promise<CatalogArtifact[]> {
    const limit=Math.max(1,Math.min(query.limit,20));
    const result=await this.client.query<CatalogRow>(
      "SELECT * FROM storage.list_discoverable_catalog($1,$2,$3,$4)",
      [query.recipeKey ?? null,query.adapter,query.capabilityContract,limit],
    );
    return result.rows.map(catalogRecord);
  }

  async getAuthorizedArtifact(artifactHash:string):Promise<CatalogArtifact|null> {
    const result=await this.client.query<CatalogRow>(
      `SELECT a.id,a.owner_tenant_id,a.artifact_hash,a.schema_version,a.canonical_body,a.state,p.id publication_id,
        p.publisher_tenant_id,p.signing_key_id,p.signature
       FROM storage.recipe_artifacts a LEFT JOIN storage.publications p
        ON p.artifact_id=a.id AND p.artifact_hash=a.artifact_hash AND p.state='published'
       WHERE a.artifact_hash=$1 AND (a.owner_tenant_id=$2 OR EXISTS(SELECT 1 FROM storage.artifact_grants g WHERE g.artifact_id=a.id
         AND g.recipient_tenant_id=$2 AND 'read'=ANY(g.rights) AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())))
       ORDER BY (a.owner_tenant_id=$2) DESC,a.created_at DESC,a.id LIMIT 1`,[artifactHash,this.context.tenantId],
    );
    return result.rowCount===1?catalogRecord(result.rows[0]!):null;
  }

  async insertArtifact(input:{id:string;artifactHash:string;schemaVersion:string;canonicalBody:unknown;idempotencyKey:string;requestHash:string}):Promise<CatalogArtifact> {
    const replay=await this.reserveIdempotency("artifacts.create",input.idempotencyKey,input.requestHash);
    if(replay) {
      const found=await this.getAuthorizedArtifact(input.artifactHash);
      if(!found || found.id!==replay) throw new StorageInvariantError("Artifact replay is not visible");
      return found;
    }
    await this.client.query(`INSERT INTO storage.recipe_artifacts(id,owner_tenant_id,artifact_hash,schema_version,canonical_body,state)
      VALUES($1,$2,$3,$4,$5,'private')`,[input.id,this.context.tenantId,input.artifactHash,input.schemaVersion,input.canonicalBody]);
    await this.bindIdempotency("artifacts.create",input.idempotencyKey,input.id);
    const created=await this.getAuthorizedArtifact(input.artifactHash);
    if(!created) throw new StorageInvariantError("Created artifact is not visible");
    return created;
  }

  async grantArtifact(input:{id:string;artifactId:string;recipientScope:"tenant";recipientTenantId:string;rights:readonly string[];expiresAt?:Date;idempotencyKey:string;requestHash:string}):Promise<void> {
    const replay=await this.reserveIdempotency("artifact_grants.create",input.idempotencyKey,input.requestHash);
    if(replay) return;
    await this.client.query(`INSERT INTO storage.artifact_grants(id,artifact_id,recipient_scope,recipient_tenant_id,rights,expires_at,granted_by_tenant_id,granted_by_actor_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[input.id,input.artifactId,input.recipientScope,input.recipientTenantId ?? null,[...input.rights],input.expiresAt ?? null,this.context.tenantId,this.context.actorId]);
    await this.bindIdempotency("artifact_grants.create",input.idempotencyKey,input.id);
  }

  async insertPublication(input:{id:string;artifactId:string;artifactHash:string;signingKeyId:string;signature:Uint8Array;visibility:"private"|"provider_catalog"|"shared_allowlist";state:"submitted"|"approved"|"published";reviewedMetadata:unknown;idempotencyKey:string;requestHash:string}):Promise<PublicationRecord> {
    const replay=await this.reserveIdempotency("publications.create",input.idempotencyKey,input.requestHash);
    if(replay) { const found=await this.getPublicationForUpdate(replay); if(!found) throw new StorageInvariantError("Publication replay is not visible"); return found; }
    const row=one(await this.client.query<PublicationRow>(`INSERT INTO storage.publications
      (id,publisher_tenant_id,publisher_actor_id,artifact_id,artifact_hash,signing_key_id,signature,visibility,state,reviewed_metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,[input.id,this.context.tenantId,this.context.actorId,input.artifactId,input.artifactHash,input.signingKeyId,Buffer.from(input.signature),input.visibility,input.state,input.reviewedMetadata]));
    if(input.state==="published") {
      await this.client.query("UPDATE storage.recipe_artifacts SET state='published' WHERE id=$1 AND owner_tenant_id=$2",[input.artifactId,this.context.tenantId]);
    }
    await this.bindIdempotency("publications.create",input.idempotencyKey,input.id);
    return publicationRecord(row);
  }

  async getPublicationForUpdate(id:string):Promise<PublicationRecord|null> {
    const result=await this.client.query<PublicationRow>("SELECT * FROM storage.publications WHERE id=$1 AND publisher_tenant_id=$2 AND publisher_actor_id=$3 FOR UPDATE",[id,this.context.tenantId,this.context.actorId]);
    return result.rowCount===1?publicationRecord(result.rows[0]!):null;
  }

  async getAuthorizedPublication(id:string):Promise<PublicationRecord|null> {
    const result=await this.client.query<PublicationRow>(`SELECT p.* FROM storage.publications p
      JOIN storage.recipe_artifacts a ON a.id=p.artifact_id AND a.artifact_hash=p.artifact_hash
      WHERE p.id=$1 AND (p.publisher_tenant_id=$2 OR EXISTS(SELECT 1 FROM storage.artifact_grants g
        WHERE g.artifact_id=a.id AND g.recipient_tenant_id=$2 AND 'read'=ANY(g.rights)
          AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())))`,[id,this.context.tenantId]);
    return result.rowCount===1?publicationRecord(result.rows[0]!):null;
  }

  async updatePublicationState(id:string,state:"withdrawn"|"security_revoked",control:{idempotencyKey:string;requestHash:string}):Promise<PublicationRecord|null> {
    const operation=`publications.${state}`;
    const replay=await this.reserveIdempotency(operation,control.idempotencyKey,control.requestHash);
    if(replay) return this.getPublicationForUpdate(replay);
    const result=await this.client.query<PublicationRow>(`UPDATE storage.publications SET state=$2,
      withdrawn_at=CASE WHEN $2='withdrawn' THEN clock_timestamp() ELSE withdrawn_at END,
      revoked_at=CASE WHEN $2='security_revoked' THEN clock_timestamp() ELSE revoked_at END
      WHERE id=$1 AND publisher_tenant_id=$3 AND publisher_actor_id=$4 RETURNING *`,[id,state,this.context.tenantId,this.context.actorId]);
    if(result.rowCount!==1) return null;
    if(state==="security_revoked") await this.client.query("UPDATE storage.recipe_artifacts SET state='security_revoked' WHERE id=$1 AND owner_tenant_id=$2",[result.rows[0]!.artifact_id,this.context.tenantId]);
    await this.bindIdempotency(operation,control.idempotencyKey,id);
    return publicationRecord(result.rows[0]!);
  }

  async insertInstallation(input:{id:string;artifactId:string;artifactHash:string;config:unknown;policyVersion:string;idempotencyKey:string;requestHash:string}):Promise<InstallationRecord> {
    const replay=await this.reserveIdempotency("installations.create",input.idempotencyKey,input.requestHash);
    if(replay) return this.requireInstallation(replay);
    const installable=await this.client.query(`SELECT 1 FROM storage.recipe_artifacts a WHERE a.id=$1 AND a.artifact_hash=$2 AND (
      a.owner_tenant_id=$3 OR EXISTS(SELECT 1 FROM storage.artifact_grants g WHERE g.artifact_id=a.id AND g.recipient_tenant_id=$3
        AND 'install'=ANY(g.rights) AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())))`,[input.artifactId,input.artifactHash,this.context.tenantId]);
    if(installable.rowCount!==1) throw new StorageInvariantError("Artifact is not available");
    const row=one(await this.client.query<InstallationRow>(`INSERT INTO storage.installations
      (tenant_id,id,artifact_id,artifact_hash,config,status,installed_by,policy_version)
      VALUES($1,$2,$3,$4,$5,'active',$6,$7) RETURNING id,artifact_id,artifact_hash,status,policy_version`,
      [this.context.tenantId,input.id,input.artifactId,input.artifactHash,input.config,this.context.actorId,input.policyVersion]));
    await this.bindIdempotency("installations.create",input.idempotencyKey,input.id);
    return installationRecord(row);
  }

  async listInstallations():Promise<InstallationRecord[]> {
    const result=await this.client.query<InstallationRow>("SELECT id,artifact_id,artifact_hash,status,policy_version FROM storage.installations WHERE tenant_id=$1 ORDER BY created_at DESC,id",[this.context.tenantId]);
    return result.rows.map(installationRecord);
  }

  async listInstallationDetails():Promise<InstallationDetailRecord[]> {
    const result=await this.client.query<InstallationDetailRow>(`SELECT i.id,i.artifact_id,i.artifact_hash,i.status,i.policy_version,
      a.canonical_body->>'recipeKey' recipe_key,COALESCE(a.canonical_body->>'displayName',a.canonical_body->>'recipeKey') display_name,
      COALESCE(a.canonical_body->>'schemaVersion',a.schema_version) version,i.created_at installed_at,
      COALESCE(e.status,'not_run') evidence_status,e.created_at last_validated_at
      FROM storage.installations i JOIN storage.recipe_artifacts a ON a.id=i.artifact_id AND a.artifact_hash=i.artifact_hash
      LEFT JOIN LATERAL(SELECT status,created_at FROM storage.evidence_bundles eb WHERE eb.owner_tenant_id=i.tenant_id
        AND eb.artifact_hash=i.artifact_hash ORDER BY created_at DESC,id LIMIT 1)e ON true
      WHERE i.tenant_id=$1 ORDER BY i.created_at DESC,i.id`,[this.context.tenantId]);
    return result.rows.map(installationDetailRecord);
  }

  async getInstallationForPlan(id:string):Promise<InstallationPlanContext|null> {
    const result=await this.client.query<InstallationPlanRow>(`SELECT i.id,i.artifact_id,i.artifact_hash,i.status,i.policy_version,i.config,
      a.owner_tenant_id,a.schema_version,a.canonical_body,a.state artifact_state,i.created_at installed_at,
      a.canonical_body->>'recipeKey' recipe_key,COALESCE(a.canonical_body->>'displayName',a.canonical_body->>'recipeKey') display_name,
      COALESCE(a.canonical_body->>'schemaVersion',a.schema_version) version,COALESCE(e.status,'not_run') evidence_status,e.created_at last_validated_at
      FROM storage.installations i JOIN storage.recipe_artifacts a ON a.id=i.artifact_id AND a.artifact_hash=i.artifact_hash
      LEFT JOIN LATERAL(SELECT status,created_at FROM storage.evidence_bundles eb WHERE eb.owner_tenant_id=i.tenant_id
        AND eb.artifact_hash=i.artifact_hash ORDER BY created_at DESC,id LIMIT 1)e ON true WHERE i.tenant_id=$1 AND i.id=$2`,[this.context.tenantId,id]);
    if(result.rowCount!==1) return null;
    const row=result.rows[0]!;
    return {installation:installationDetailRecord(row),config:row.config,artifact:{id:row.artifact_id,ownerTenantId:row.owner_tenant_id,artifactHash:row.artifact_hash,
      schemaVersion:row.schema_version,canonicalBody:row.canonical_body,state:row.artifact_state,publicationId:null,publisherTenantId:null,signingKeyId:null,signature:null}};
  }

  async disableInstallation(id:string,control:{idempotencyKey:string;requestHash:string}):Promise<InstallationRecord|null> {
    const replay=await this.reserveIdempotency("installations.disable",control.idempotencyKey,control.requestHash);
    if(replay) return this.requireInstallation(replay);
    const result=await this.client.query<InstallationRow>("UPDATE storage.installations SET status='disabled' WHERE tenant_id=$1 AND id=$2 RETURNING id,artifact_id,artifact_hash,status,policy_version",[this.context.tenantId,id]);
    if(result.rowCount!==1) return null;
    await this.bindIdempotency("installations.disable",control.idempotencyKey,id);
    return installationRecord(result.rows[0]!);
  }

  async getPublicationKey(keyId:string):Promise<PublicationKey|null> {
    const result=await this.client.query<KeyRow>("SELECT id,algorithm,public_key,status FROM storage.signing_keys WHERE id=$1",[keyId]);
    return result.rowCount===1?{id:result.rows[0]!.id,algorithm:result.rows[0]!.algorithm,publicKey:result.rows[0]!.public_key,status:result.rows[0]!.status}:null;
  }

  async insertSigningKey(input:{id:string;publicKey:Uint8Array;privateKeyRef:string;idempotencyKey:string;requestHash:string}):Promise<PublicationKey> {
    const replay=await this.reserveIdempotency("signing_keys.create",input.idempotencyKey,input.requestHash);
    if(replay) { const found=await this.getPublicationKey(replay); if(!found) throw new StorageInvariantError("Signing key replay is not visible"); return found; }
    await this.client.query("INSERT INTO storage.signing_keys(id,owner_tenant_id,algorithm,public_key,status) VALUES($1,$2,'Ed25519',$3,'active')",[input.id,this.context.tenantId,Buffer.from(input.publicKey)]);
    await this.client.query("INSERT INTO storage.signing_key_secrets(tenant_id,key_id,private_key_ref) VALUES($1,$2,$3)",[this.context.tenantId,input.id,input.privateKeyRef]);
    await this.bindIdempotency("signing_keys.create",input.idempotencyKey,input.id);
    const created=await this.getPublicationKey(input.id);
    if(!created) throw new StorageInvariantError("Created signing key is not visible");
    return created;
  }

  async getPrivateSigningKeyRef(keyId:string):Promise<string|null> {
    const result=await this.client.query<{private_key_ref:string}>("SELECT private_key_ref FROM storage.signing_key_secrets WHERE tenant_id=$1 AND key_id=$2",[this.context.tenantId,keyId]);
    return result.rowCount===1?result.rows[0]!.private_key_ref:null;
  }

  async consumeTicket(input:{ticketId:string;issuer:string;jtiHash:string;nonceHash:string;audience:string;expiresAt:Date}):Promise<boolean> {
    const ticket=await this.client.query(`INSERT INTO storage.session_tickets
      (tenant_id,id,actor_id,issuer,jti_hash,nonce_hash,audience,expires_at,consumed_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp() WHERE $8 > clock_timestamp()
      ON CONFLICT DO NOTHING RETURNING id`,
      [this.context.tenantId,input.ticketId,this.context.actorId,input.issuer,input.jtiHash,input.nonceHash,input.audience,input.expiresAt]);
    return ticket.rowCount===1;
  }

  async exchangeSessionTicket(input:{ticketId:string;issuer:string;jtiHash:string;nonceHash:string;audience:string;sessionId:string;policyVersion:string;ticketExpiresAt:Date;sessionExpiresAt:Date}):Promise<SessionRecord> {
    if(!await this.consumeTicket({ticketId:input.ticketId,issuer:input.issuer,jtiHash:input.jtiHash,nonceHash:input.nonceHash,audience:input.audience,expiresAt:input.ticketExpiresAt})) throw new StorageConflictError();
    const row=one(await this.client.query<SessionRow>(`INSERT INTO storage.sessions
      (tenant_id,id,actor_id,ticket_id,policy_version,expires_at) VALUES($1,$2,$3,$4,$5,$6)
      RETURNING id,actor_id,ticket_id,policy_version,expires_at`,
      [this.context.tenantId,input.sessionId,this.context.actorId,input.ticketId,input.policyVersion,input.sessionExpiresAt]));
    return {id:row.id,actorId:row.actor_id,ticketId:row.ticket_id,policyVersion:row.policy_version,expiresAt:row.expires_at};
  }

  async appendAuditEvent(input:{id:string;subjectType:string;subjectId:string;action:string;reasonCode?:string;traceId:string}):Promise<void> {
    await this.client.query(`INSERT INTO storage.audit_events
      (tenant_id,id,actor_id,subject_type,subject_id,action,reason_code,trace_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [this.context.tenantId,input.id,this.context.actorId,input.subjectType,input.subjectId,input.action,input.reasonCode ?? null,input.traceId]);
  }

  async insertEvidence(input:{id:string;artifactHash:string;environmentDigest:string;suiteVersion:string;status:"passed"|"failed"|"blocked"|"not_run"|"not_applicable";artifactRefs:unknown;privacyScope:"private"|"generic"}):Promise<void> {
    const result=await this.client.query(`INSERT INTO storage.evidence_bundles
      (id,owner_tenant_id,artifact_hash,environment_digest,suite_version,status,artifact_refs,privacy_scope)
      SELECT $1,$2,a.artifact_hash,$4,$5,$6,$7,$8 FROM storage.recipe_artifacts a
      WHERE a.artifact_hash=$3 AND (a.owner_tenant_id=$2 OR a.state='published') ORDER BY (a.owner_tenant_id=$2) DESC LIMIT 1`,
      [input.id,this.context.tenantId,input.artifactHash,input.environmentDigest,input.suiteVersion,input.status,input.artifactRefs,input.privacyScope]);
    if(result.rowCount!==1) throw new StorageInvariantError("Evidence artifact is not authorized");
  }

  async getEvidence(id:string):Promise<EvidenceRecord|null> {
    const result=await this.client.query<EvidenceRow>(`SELECT id,status,artifact_hash,environment_digest,suite_version,privacy_scope,created_at
      FROM storage.evidence_bundles WHERE id=$1`,[id]);
    return result.rowCount===1?evidenceRecord(result.rows[0]!):null;
  }

  async hasApplicableApprovalEvidence(approvalId:string,environmentDigest:string):Promise<boolean> {
    const result=await this.client.query(`SELECT 1 FROM storage.approvals a
      JOIN storage.plans p ON p.tenant_id=a.tenant_id AND p.id=a.plan_id AND p.plan_version=a.plan_version
      JOIN LATERAL jsonb_array_elements_text(COALESCE(p.body->'evidenceRefs','[]'::jsonb)) ref(id) ON true
      JOIN storage.evidence_bundles eb ON eb.id::text=ref.id AND eb.owner_tenant_id=p.tenant_id
      WHERE a.tenant_id=$1 AND a.id=$2 AND a.actor_id=$3 AND eb.status='passed' AND eb.environment_digest=$4
        AND eb.artifact_hash=p.artifact_hash AND eb.artifact_refs->>'bindingKind'='plan'
        AND eb.artifact_refs->>'artifactHash'=p.artifact_hash AND eb.artifact_refs->>'planHash'=p.plan_hash
        AND eb.artifact_refs->>'policyVersion'=p.policy_version AND eb.artifact_refs->>'scope'='association-set-laws-v1'
      LIMIT 1`,[this.context.tenantId,approvalId,this.context.actorId,environmentDigest]);
    return result.rowCount===1;
  }

  async hasApplicableArtifactEvidence(artifactHash:string,policyVersion:string,environmentDigest:string):Promise<boolean> {
    const result=await this.client.query(`SELECT 1 FROM storage.evidence_bundles eb WHERE eb.owner_tenant_id=$1
      AND eb.artifact_hash=$2 AND eb.status='passed' AND eb.environment_digest=$3
      AND eb.artifact_refs->>'bindingKind'='artifact' AND eb.artifact_refs->>'artifactHash'=$2
      AND eb.artifact_refs->>'policyVersion'=$4 AND eb.artifact_refs->>'scope'='association-set-laws-v1'
      LIMIT 1`,[this.context.tenantId,artifactHash,environmentDigest,policyVersion]);
    return result.rowCount===1;
  }

  async recordAttemptIntent(lease:JobLease,input:AttemptIntent):Promise<AttemptRecord|null> {
    const result=await this.client.query<AttemptRow>(`WITH valid AS (
      SELECT 1 FROM storage.jobs j WHERE j.id=$9 AND j.tenant_id=$1 AND j.execution_id=$2 AND j.status='leased'
        AND j.lease_owner=$10 AND j.fence=$8 AND j.lease_until>clock_timestamp()
    ), inserted AS (
      INSERT INTO storage.step_attempts(tenant_id,execution_id,row_id,step_id,attempt_no,semantic_input_hash,idempotency_key,fence,state)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,'intent_recorded' FROM valid
      ON CONFLICT(tenant_id,execution_id,row_id,step_id,attempt_no) DO NOTHING
      RETURNING idempotency_key,attempt_no,state,receipt_ref,observation_ref,error_code,true inserted
    ), existing AS (
      SELECT a.idempotency_key,a.attempt_no,a.state,a.receipt_ref,a.observation_ref,a.error_code,false inserted
      FROM storage.step_attempts a,valid WHERE a.tenant_id=$1 AND a.execution_id=$2 AND a.row_id=$3 AND a.step_id=$4
        AND a.attempt_no=$5 AND a.semantic_input_hash=$6 AND a.idempotency_key=$7 AND NOT EXISTS(SELECT 1 FROM inserted)
    ) SELECT * FROM inserted UNION ALL SELECT * FROM existing LIMIT 1`,
      [this.context.tenantId,input.executionId,input.rowId,input.stepId,input.attemptNo,input.semanticInputHash,input.operationKey,lease.fence,lease.jobId,lease.leaseOwner]);
    return result.rowCount===1?attemptRecord(result.rows[0]!):null;
  }

  async adoptAttemptForReconciliation(lease:JobLease,input:AttemptIntent):Promise<AttemptRecord|null> {
    const result=await this.client.query<AttemptRow>(`UPDATE storage.step_attempts a SET fence=$8
      FROM storage.jobs j WHERE a.tenant_id=$1 AND a.execution_id=$2 AND a.row_id=$3 AND a.step_id=$4 AND a.attempt_no=$5
        AND a.semantic_input_hash=$6 AND a.idempotency_key=$7 AND a.state IN('sent','unknown')
        AND j.id=$9 AND j.tenant_id=$1 AND j.execution_id=$2 AND j.kind='reconcile' AND j.status='leased'
        AND j.lease_owner=$10 AND j.fence=$8 AND j.lease_until>clock_timestamp()
      RETURNING a.idempotency_key,a.attempt_no,a.state,a.receipt_ref,a.observation_ref,a.error_code,false inserted`,
      [this.context.tenantId,input.executionId,input.rowId,input.stepId,input.attemptNo,input.semanticInputHash,input.operationKey,lease.fence,lease.jobId,lease.leaseOwner]);
    return result.rowCount===1?attemptRecord(result.rows[0]!):null;
  }

  async authorizeEffectClaim(input:{executionId:string;planHash:string;planVersion:number;approvalId:string;operationKey:string;jobId:string;leaseOwner:string;fence:number;hostSessionId:string;policyVersion:string}):Promise<EffectClaimDecision> {
    const result=await this.client.query<EffectClaimRow>(`SELECT e.id execution_id,e.approval_id,p.plan_hash,p.plan_version,e.actor_id,
      a.host_session_id,t.policy_version
      FROM storage.executions e
      JOIN storage.plans p ON p.tenant_id=e.tenant_id AND p.id=e.plan_id AND p.plan_version=e.plan_version
      JOIN storage.approvals a ON a.tenant_id=e.tenant_id AND a.id=e.approval_id
      JOIN storage.sessions s ON s.tenant_id=e.tenant_id AND s.id=a.host_session_id AND s.actor_id=e.actor_id
      JOIN storage.actors ac ON ac.tenant_id=e.tenant_id AND ac.actor_id=e.actor_id
      JOIN storage.tenants t ON t.id=e.tenant_id
      LEFT JOIN storage.installations i ON i.tenant_id=p.tenant_id AND i.id=p.installation_id
      JOIN storage.recipe_artifacts ra ON ra.artifact_hash=p.artifact_hash AND (
        (p.installation_id IS NULL AND ra.owner_tenant_id=p.tenant_id) OR (p.installation_id IS NOT NULL AND ra.id=i.artifact_id)
      )
      JOIN storage.jobs j ON j.tenant_id=e.tenant_id AND j.execution_id=e.id
      JOIN storage.step_attempts sa ON sa.tenant_id=e.tenant_id AND sa.execution_id=e.id
      WHERE e.tenant_id=$1 AND e.actor_id=$2 AND e.id=$3 AND e.state='running'
        AND p.plan_hash=$4 AND p.plan_version=$5 AND p.state='ready' AND p.expires_at>clock_timestamp()
        AND p.policy_version=$12 AND t.policy_version=$12 AND t.status='active'
        AND a.id=$6 AND a.plan_hash=p.plan_hash AND a.plan_version=p.plan_version AND a.actor_id=e.actor_id
        AND a.consumed_execution_id=e.id AND a.expires_at>clock_timestamp() AND a.host_session_id=$10
        AND s.id=$10 AND s.policy_version=$12 AND s.expires_at>clock_timestamp() AND s.revoked_at IS NULL
        AND ac.state='enabled' AND ac.last_policy_version=$12
        AND ra.state<>'security_revoked' AND (p.installation_id IS NULL OR i.status='active')
        AND NOT EXISTS(SELECT 1 FROM storage.publications revoked WHERE revoked.artifact_id=ra.id AND revoked.state='security_revoked')
        AND j.id=$8 AND j.lease_owner=$9 AND j.fence=$11 AND j.status='leased' AND j.lease_until>clock_timestamp()
        AND sa.idempotency_key=$7 AND sa.fence=$11 AND sa.state IN('intent_recorded','sent')
      LIMIT 1`,
      [this.context.tenantId,this.context.actorId,input.executionId,input.planHash,input.planVersion,input.approvalId,input.operationKey,input.jobId,input.leaseOwner,input.hostSessionId,input.fence,input.policyVersion]);
    if(result.rowCount!==1) return {authorized:false,reasonCode:"claim_invalid"};
    const row=result.rows[0]!;
    return {authorized:true,executionId:row.execution_id,approvalId:row.approval_id,planHash:row.plan_hash,planVersion:row.plan_version,actorId:row.actor_id,hostSessionId:row.host_session_id,policyVersion:row.policy_version};
  }

  async transitionAttempt(lease:JobLease,input:AttemptIntent,state:Exclude<AttemptState,"intent_recorded">,receiptRef?:string,observationRef?:string,errorCode?:string):Promise<boolean> {
    const result = await this.client.query(
      `UPDATE storage.step_attempts a SET state=$8,receipt_ref=COALESCE($9,receipt_ref),observation_ref=COALESCE($10,observation_ref),
        error_code=$11,sent_at=CASE WHEN $8='sent' THEN clock_timestamp() ELSE sent_at END,
        finished_at=CASE WHEN $8 IN ('confirmed','no_effect','rejected','unknown') THEN clock_timestamp() ELSE finished_at END
       FROM storage.jobs j WHERE a.tenant_id=$1 AND a.execution_id=$2 AND a.row_id=$3 AND a.step_id=$4 AND a.attempt_no=$5
        AND j.id=$6 AND j.tenant_id=$1 AND j.execution_id=$2 AND j.lease_owner=$7 AND j.fence=a.fence AND j.fence=$12 AND j.status='leased'`,
      [this.context.tenantId,input.executionId,input.rowId,input.stepId,input.attemptNo,lease.jobId,lease.leaseOwner,state,receiptRef ?? null,observationRef ?? null,errorCode ?? null,lease.fence],
    );
    return result.rowCount === 1;
  }

  private async reserveIdempotency(operation: string, key: string, requestHash: string): Promise<string | null> {
    await this.client.query(
      `INSERT INTO storage.idempotency_records (tenant_id,actor_id,operation,key,request_hash,expires_at)
       VALUES ($1,$2,$3,$4,$5,clock_timestamp()+interval '24 hours') ON CONFLICT DO NOTHING`,
      [this.context.tenantId,this.context.actorId,operation,key,requestHash],
    );
    const row = one(await this.client.query<{request_hash:string;resource_id:string|null}>(
      "SELECT request_hash,resource_id FROM storage.idempotency_records WHERE tenant_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4 FOR UPDATE",
      [this.context.tenantId,this.context.actorId,operation,key],
    ));
    if (row.request_hash !== requestHash) throw new StorageConflictError();
    return row.resource_id;
  }

  private async bindIdempotency(operation: string, key: string, resourceId: string) {
    await this.client.query(
      "UPDATE storage.idempotency_records SET resource_id=$5 WHERE tenant_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4",
      [this.context.tenantId,this.context.actorId,operation,key,resourceId],
    );
  }

  private async enqueueJob(input:{id:string;actorId:string;backendKey?:string;requestId?:string;executionId?:string;kind:"generation"|"execution"|"reconcile"}) {
    const result=await this.client.query<{outcome:"admitted"|"tenant_full"|"global_full"}>(`SELECT storage.enqueue_job($1,$2,$3,
      COALESCE($4,(SELECT backend_key FROM storage.tenants WHERE id=$2)),$5,$6,$7) outcome`,
      [input.id,this.context.tenantId,input.actorId,input.backendKey ?? null,input.requestId ?? null,input.executionId ?? null,input.kind]);
    const outcome=result.rows[0]?.outcome;
    if(outcome==="tenant_full") throw new StorageCapacityError("tenant");
    if(outcome==="global_full") throw new StorageCapacityError("global");
    if(outcome!=="admitted") throw new StorageInvariantError("Job admission did not return an outcome");
  }

  private assertGenerationScope(scope:GenerationScope):void {
    if(scope.tenantId!==this.context.tenantId || scope.actorId!==this.context.actorId) throw new StorageInvariantError("Generation scope mismatch");
  }

  private async incrementUsage(input:{generationCalls?:bigint;inputTokens?:bigint;outputTokens?:bigint;estimatedCostMicros?:bigint}):Promise<void> {
    await this.client.query(`INSERT INTO storage.usage_daily(tenant_id,usage_day,generation_calls,input_tokens,output_tokens,estimated_cost_micros)
      VALUES($1,current_date,$2,$3,$4,$5) ON CONFLICT(tenant_id,usage_day) DO UPDATE SET
      generation_calls=storage.usage_daily.generation_calls+EXCLUDED.generation_calls,
      input_tokens=storage.usage_daily.input_tokens+EXCLUDED.input_tokens,
      output_tokens=storage.usage_daily.output_tokens+EXCLUDED.output_tokens,
      estimated_cost_micros=storage.usage_daily.estimated_cost_micros+EXCLUDED.estimated_cost_micros`,
      [this.context.tenantId,(input.generationCalls ?? 0n).toString(),(input.inputTokens ?? 0n).toString(),(input.outputTokens ?? 0n).toString(),(input.estimatedCostMicros ?? 0n).toString()]);
  }

  private async requireRequest(id:string) { return requestRecord(one(await this.client.query<RequestRow>("SELECT id,actor_id,state,created_at FROM storage.requests WHERE tenant_id=$1 AND id=$2",[this.context.tenantId,id]))); }
  private async requirePlan(id:string) { return planRecord(one(await this.client.query<PlanRow>("SELECT id,actor_id,plan_version,plan_hash,state,expires_at FROM storage.plans WHERE tenant_id=$1 AND id=$2",[this.context.tenantId,id]))); }
  private async requireApproval(id:string) { return approvalRecord(one(await this.client.query<ApprovalRow>("SELECT id,plan_id,plan_version,plan_hash,actor_id,host_session_id,expires_at,consumed_execution_id FROM storage.approvals WHERE tenant_id=$1 AND id=$2",[this.context.tenantId,id]))); }
  private async requireExecution(id:string) { return executionRecord(one(await this.client.query<ExecutionRow>("SELECT id,plan_id,plan_version,approval_id,actor_id,prior_execution_id,state,revision FROM storage.executions WHERE tenant_id=$1 AND id=$2",[this.context.tenantId,id]))); }
  private async requireInstallation(id:string) { return installationRecord(one(await this.client.query<InstallationRow>("SELECT id,artifact_id,artifact_hash,status,policy_version FROM storage.installations WHERE tenant_id=$1 AND id=$2",[this.context.tenantId,id]))); }
}

interface RequestRow extends QueryResultRow { id:string;actor_id:string;state:RequestRecord["state"];created_at:Date }
interface MessageRow extends QueryResultRow { id:string;request_id:string;actor_id:string;client_request_id:string;redacted_text:string;created_at:Date }
interface GenerationBundleRow extends QueryResultRow { id:string;actor_id:string;redacted_text:string;context_ref:GenerationBundle["request"]["contextRef"];budget:GenerationBundle["request"]["budget"];state:RequestRecord["state"];created_at:Date;policy_version:string;backend_key:string;actor_role:GenerationBundle["actor"]["role"];actor_state:"enabled"|"disabled";manifest_id:string;manifest_hash:string;adapter_version:string;manifest_body:GenerationBundle["capabilityManifest"]["body"] }
interface CandidateRow extends QueryResultRow { id:string;request_id:string;version:string;artifact_hash:string|null;recipe_key:string;display_name:string;required_capabilities:string[];compatibility:RequestCandidateRecord["compatibility"];evidence_status:RequestCandidateRecord["evidenceStatus"];estimated_cost:RequestCandidateRecord["estimatedCost"];safe_metadata:RequestCandidateRecord["safeMetadata"];state:RequestCandidateRecord["state"];selected_choice:RequestCandidateRecord["selectedChoice"] }
interface PlanRow extends QueryResultRow { id:string;actor_id:string;plan_version:number;plan_hash:string;state:PlanRecord["state"];expires_at:Date }
interface PlanDetailRow extends PlanRow { request_id:string;installation_id:string|null;artifact_hash:string;adapter_version:string;policy_version:string;capability_manifest_hash:string;body:PlanDetailRecord["body"];created_at:Date }
interface ApprovalRow extends QueryResultRow { id:string;plan_id:string;plan_version:number;plan_hash:string;actor_id:string;host_session_id:string|null;expires_at:Date;consumed_execution_id:string|null }
interface ExecutionRow extends QueryResultRow { id:string;plan_id:string;plan_version:number;approval_id:string;actor_id:string;prior_execution_id:string|null;state:ExecutionRecord["state"];revision:string|number }
interface AdmissionRow extends QueryResultRow { plan_id:string;plan_version:number;approval_id:string;actor_id:string;authorized:boolean }
interface BundleRow extends QueryResultRow { execution:Record<string,unknown>;plan:Record<string,unknown>;approval:Record<string,unknown>;installation:Record<string,unknown>|null;artifact:Record<string,unknown>|null;actor:Record<string,unknown>;host_session_id:string|null }
interface CatalogRow extends QueryResultRow { id:string;owner_tenant_id:string|null;artifact_hash:string;schema_version:string;canonical_body:never;state:string;publication_id:string|null;publisher_tenant_id:string|null;signing_key_id:string|null;signature:Buffer|null }
interface PublicationRow extends QueryResultRow { id:string;publisher_tenant_id:string;publisher_actor_id:string;artifact_id:string;artifact_hash:string;signing_key_id:string;signature:Buffer;visibility:"private"|"provider_catalog"|"shared_allowlist";state:string;reviewed_metadata:never }
interface InstallationRow extends QueryResultRow { id:string;artifact_id:string;artifact_hash:string;status:InstallationRecord["status"];policy_version:string }
interface InstallationDetailRow extends InstallationRow {recipe_key:string;display_name:string;version:string;evidence_status:InstallationDetailRecord["evidenceStatus"];installed_at:Date;last_validated_at:Date|null}
interface InstallationPlanRow extends InstallationDetailRow {config:InstallationPlanContext["config"];owner_tenant_id:string|null;schema_version:string;canonical_body:InstallationPlanContext["artifact"]["canonicalBody"];artifact_state:string}
interface KeyRow extends QueryResultRow { id:string;algorithm:"Ed25519";public_key:Buffer;status:string }
interface SessionRow extends QueryResultRow { id:string;actor_id:string;ticket_id:string;policy_version:string;expires_at:Date }
interface AttemptRow extends QueryResultRow { idempotency_key:string;attempt_no:number;state:AttemptState;receipt_ref:string|null;observation_ref:string|null;error_code:string|null;inserted:boolean }
interface EffectClaimRow extends QueryResultRow { execution_id:string;approval_id:string;plan_hash:string;plan_version:number;actor_id:string;host_session_id:string;policy_version:string }
interface EvidenceRow extends QueryResultRow { id:string;status:EvidenceRecord["status"];artifact_hash:string;environment_digest:string;suite_version:string;privacy_scope:EvidenceRecord["privacyScope"];created_at:Date }
interface GenerationReservationRow extends QueryResultRow { id:string;status:"pending"|"running"|"completed"|"failed";fence:string|number;attempt_count:number;max_attempts:number;artifact_id:string|null;retryable:boolean;lease_until:Date|null }
function one<T extends QueryResultRow>(result:{rowCount:number|null;rows:T[]}):T { if(result.rowCount!==1) throw new StorageInvariantError("Expected exactly one row"); return result.rows[0]!; }
function stableJson(value:unknown):string {
  if(value===null || typeof value!=="object") return JSON.stringify(value);
  if(Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string,unknown>).sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>`${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}
function jsonRecord(value:unknown):Record<string,unknown> {
  if(typeof value==="string") { const parsed:unknown=JSON.parse(value); if(parsed && typeof parsed==="object" && !Array.isArray(parsed)) return parsed as Record<string,unknown>; }
  if(value && typeof value==="object" && !Array.isArray(value)) return value as Record<string,unknown>;
  throw new StorageInvariantError("Persisted JSON object is malformed");
}
const requestRecord=(r:RequestRow):RequestRecord=>({id:r.id,actorId:r.actor_id,state:r.state,createdAt:r.created_at});
const messageRecord=(r:MessageRow):RequestMessageRecord=>({id:r.id,requestId:r.request_id,actorId:r.actor_id,clientRequestId:r.client_request_id,redactedText:r.redacted_text,createdAt:r.created_at});
const candidateRecord=(r:CandidateRow):RequestCandidateRecord=>({id:r.id,requestId:r.request_id,version:r.version,artifactHash:r.artifact_hash,recipeKey:r.recipe_key,displayName:r.display_name,requiredCapabilities:r.required_capabilities,compatibility:r.compatibility,evidenceStatus:r.evidence_status,estimatedCost:r.estimated_cost,safeMetadata:r.safe_metadata,state:r.state,selectedChoice:r.selected_choice});
const candidateDbInput=(c:Omit<RequestCandidateRecord,"requestId"|"state"|"selectedChoice">)=>({id:c.id,version:c.version,artifact_hash:c.artifactHash,recipe_key:c.recipeKey,display_name:c.displayName,required_capabilities:c.requiredCapabilities,compatibility:c.compatibility,evidence_status:c.evidenceStatus,estimated_cost:c.estimatedCost,safe_metadata:c.safeMetadata});
const planRecord=(r:PlanRow):PlanRecord=>({id:r.id,actorId:r.actor_id,planVersion:r.plan_version,planHash:r.plan_hash,state:r.state,expiresAt:r.expires_at});
const approvalRecord=(r:ApprovalRow):ApprovalRecord=>({id:r.id,planId:r.plan_id,planVersion:r.plan_version,planHash:r.plan_hash,actorId:r.actor_id,hostSessionId:r.host_session_id,expiresAt:r.expires_at,consumedExecutionId:r.consumed_execution_id});
const executionRecord=(r:ExecutionRow):ExecutionRecord=>({id:r.id,planId:r.plan_id,planVersion:r.plan_version,approvalId:r.approval_id,actorId:r.actor_id,priorExecutionId:r.prior_execution_id,state:r.state,revision:Number(r.revision)});
const catalogRecord=(r:CatalogRow):CatalogArtifact=>({id:r.id,ownerTenantId:r.owner_tenant_id,artifactHash:r.artifact_hash,schemaVersion:r.schema_version,canonicalBody:r.canonical_body,state:r.state,publicationId:r.publication_id,publisherTenantId:r.publisher_tenant_id,signingKeyId:r.signing_key_id,signature:r.signature});
const publicationRecord=(r:PublicationRow):PublicationRecord=>({id:r.id,publisherTenantId:r.publisher_tenant_id,publisherActorId:r.publisher_actor_id,artifactId:r.artifact_id,artifactHash:r.artifact_hash,signingKeyId:r.signing_key_id,signature:r.signature,visibility:r.visibility,state:r.state,reviewedMetadata:r.reviewed_metadata});
const installationRecord=(r:InstallationRow):InstallationRecord=>({id:r.id,artifactId:r.artifact_id,artifactHash:r.artifact_hash,status:r.status,policyVersion:r.policy_version});
const installationDetailRecord=(r:InstallationDetailRow):InstallationDetailRecord=>({...installationRecord(r),recipeKey:r.recipe_key,displayName:r.display_name,version:r.version,evidenceStatus:r.evidence_status,installedAt:r.installed_at,lastValidatedAt:r.last_validated_at});
const attemptRecord=(r:AttemptRow):AttemptRecord=>({operationKey:r.idempotency_key,attemptNo:r.attempt_no,state:r.state,receiptRef:r.receipt_ref,observationRef:r.observation_ref,errorCode:r.error_code,inserted:r.inserted});
const evidenceRecord=(r:EvidenceRow):EvidenceRecord=>({id:r.id,status:r.status,artifactHash:r.artifact_hash,environmentDigest:r.environment_digest,suiteVersion:r.suite_version,privacyScope:r.privacy_scope,createdAt:r.created_at});
