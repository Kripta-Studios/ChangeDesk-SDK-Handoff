import type { Pool, QueryResultRow } from "pg";
import type { JobFinishStatus, JobKind, JobLease } from "./types.js";

export class JobStore {
  constructor(private readonly pool: Pool) {}

  async claimNext(input:{workerId:string;leaseSeconds:number;globalCap:number;limit?:number}):Promise<JobLease[]> {
    const leases:JobLease[]=[];
    const limit=Math.max(1,Math.min(input.limit ?? 1,100));
    for(let index=0;index<limit;index++) {
      const result=await this.pool.query<JobRow>("SELECT * FROM storage.claim_next_job($1,$2,$3)",[input.workerId,input.leaseSeconds,input.globalCap]);
      if(result.rowCount!==1) break;
      const row=result.rows[0];
      leases.push({jobId:row.id,tenantId:row.tenant_id,actorId:row.actor_id,backendKey:row.backend_key,kind:row.kind,requestId:row.request_id,executionId:row.execution_id,leaseOwner:input.workerId,fence:Number(row.fence),leaseUntil:row.lease_until,attemptCount:row.attempt_count});
    }
    return leases;
  }

  async heartbeat(lease:JobLease,leaseSeconds:number):Promise<boolean> {
    const result=await this.pool.query<{ok:boolean}>("SELECT storage.heartbeat_job($1,$2,$3,$4) ok",[lease.jobId,lease.leaseOwner,lease.fence,leaseSeconds]);
    return result.rows[0]?.ok === true;
  }

  async finish(lease:JobLease,outcome:{status:JobFinishStatus;nextAttemptAt?:Date;errorCode?:string}):Promise<boolean> {
    const result=await this.pool.query<{ok:boolean}>("SELECT storage.finish_job($1,$2,$3,$4,$5,$6) ok",[lease.jobId,lease.leaseOwner,lease.fence,outcome.status,outcome.nextAttemptAt ?? null,outcome.errorCode ?? null]);
    return result.rows[0]?.ok === true;
  }

  async recoverExpired(limit=100):Promise<number> {
    const result=await this.pool.query<{count:number|string}>("SELECT storage.recover_expired_jobs($1) count",[limit]);
    return Number(result.rows[0]?.count ?? 0);
  }
}

interface JobRow extends QueryResultRow { id:string;tenant_id:string;actor_id:string;backend_key:string;kind:JobKind;request_id:string|null;execution_id:string|null;fence:string|number;lease_until:Date;attempt_count:number }
