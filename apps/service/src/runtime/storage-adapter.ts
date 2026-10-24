import type { Attempt, ExecutionBundle, JobLease, WorkerOutcome } from "./types.js";
import type { RuntimeStorePort } from "./store-port.js";
import { hashCanonical } from "../core/hashing.js";

interface StorageTx {
  loadExecutionBundle(executionId: string): Promise<any | null>;
  recordAttemptIntent(lease: any, input: any): Promise<any | null>;
  adoptAttemptForReconciliation(lease: any, input: any): Promise<any | null>;
  transitionAttempt(lease: any, input: any, state: string, receiptRef?: string, observationRef?: string, errorCode?: string): Promise<boolean>;
}
interface StoreLike { withTenant<T>(scope: { tenantId: string; actorId: string }, work: (tx: StorageTx) => Promise<T>): Promise<T> }
interface JobStoreLike {
  claimNext(input: { workerId: string; leaseSeconds: number; globalCap: number; limit?: number }): Promise<any[]>;
  heartbeat(lease: JobLease, seconds: number): Promise<boolean>;
  finish(lease: JobLease, outcome: { status: "pending" | "completed" | "failed" | "cancelled"; nextAttemptAt?: Date; errorCode?: string }): Promise<void>;
  recoverExpired(limit?: number): Promise<number>;
}

export class StorageRuntimeAdapter implements RuntimeStorePort {
  constructor(private readonly store: StoreLike, private readonly jobs: JobStoreLike, private readonly options: { workerActorId: string; leaseSeconds: number; globalCap: number }) {}
  async claimNextJob(workerId: string): Promise<JobLease | null> { const [lease] = await this.jobs.claimNext({ workerId, leaseSeconds: this.options.leaseSeconds, globalCap: this.options.globalCap, limit: 1 }); return lease ? { ...lease, leaseUntil: new Date(lease.leaseUntil).toISOString() } : null; }
  recoverOrphanedLeases(limit?: number): Promise<number> { return this.jobs.recoverExpired(limit); }
  heartbeat(lease: JobLease): Promise<boolean> { return this.jobs.heartbeat(lease, this.options.leaseSeconds); }
  loadExecutionBundle(lease: JobLease) { return this.scoped(lease, async (tx) => { const raw = await tx.loadExecutionBundle(lease.executionId!); if (!raw) throw new Error("Execution bundle not found"); return mapBundle(raw); }); }
  recordAttemptIntent(lease: JobLease, input: Parameters<RuntimeStorePort["recordAttemptIntent"]>[1]) { const handle = { executionId: lease.executionId!, rowId: input.rowId, stepId: input.stepId, attemptNo: 1, semanticInputHash: input.semanticInputHash, operationKey: input.operationKey }; return this.scoped(lease, async (tx) => { const record = lease.kind === "reconcile" ? await tx.adoptAttemptForReconciliation(lease, handle) : await tx.recordAttemptIntent(lease, handle); return record ? { attemptId: Buffer.from(JSON.stringify(handle)).toString("base64url"), state: record.state, operationKey: record.operationKey, semanticInputHash: input.semanticInputHash } as Attempt : null; }); }
  markAttemptSent(lease: JobLease, attemptId: string) { return this.transition(lease, attemptId, "sent"); }
  confirmAttempt(lease: JobLease, attemptId: string, receipt: unknown) { return this.transition(lease, attemptId, "confirmed", receipt); }
  markAttemptUnknown(lease: JobLease, attemptId: string, code: string) { return this.transition(lease, attemptId, "unknown", undefined, code); }
  rejectAttempt(lease: JobLease, attemptId: string, code: string) { return this.transition(lease, attemptId, "rejected", undefined, code); }
  async requeueOrFinish(lease: JobLease, outcome: WorkerOutcome): Promise<void> {
    if (outcome.kind === "waiting_reconciliation") return this.jobs.finish(lease, { status: "pending", nextAttemptAt: new Date(Date.now() + 2_000), errorCode: outcome.reason });
    if (outcome.kind === "completed") return this.jobs.finish(lease, { status: "completed" });
    if (outcome.kind === "cancelled") return this.jobs.finish(lease, { status: "cancelled" });
    return this.jobs.finish(lease, { status: "failed", errorCode: outcome.kind === "failed" ? outcome.reason : "authority_expired" });
  }
  private scoped<T>(lease: JobLease, work: (tx: StorageTx) => Promise<T>) { return this.store.withTenant({ tenantId: lease.tenantId, actorId: lease.actorId }, work); }
  private transition(lease: JobLease, attemptId: string, state: string, receipt?: unknown, code?: string) {
    const input = JSON.parse(Buffer.from(attemptId, "base64url").toString("utf8"));
    const receiptRef = receipt === undefined ? undefined : hashCanonical("bridge-receipt", "1", receipt as object);
    return this.scoped(lease, (tx) => tx.transitionAttempt(lease, input, state, receiptRef, undefined, code));
  }
}

function mapBundle(raw: any): ExecutionBundle {
  const plan = raw.plan.body ?? raw.plan;
  const execution = { id: raw.execution.id, planId: raw.execution.plan_id ?? raw.execution.planId, state: raw.execution.state, ...(raw.execution.cancel_requested_at ? { cancelRequestedAt: new Date(raw.execution.cancel_requested_at).toISOString() } : {}) };
  const attempts = raw.attempts ?? [];
  const effects = (plan.perRecordEffects ?? []).filter((effect: any) => effect.expected === "apply");
  const unknownEffects = effects.filter((effect: any) => attempts.some((a: any) => a.row_id === effect.recordId && a.step_id === effect.stepId && ["sent", "unknown"].includes(a.state)));
  const pendingEffects = effects.filter((effect: any) => !attempts.some((a: any) => a.row_id === effect.recordId && a.step_id === effect.stepId && ["sent", "unknown", "confirmed", "no_effect"].includes(a.state)));
  const hostSessionId = raw.approval.host_session_id ?? raw.actor.host_session_id;
  if (typeof hostSessionId !== "string" || !hostSessionId) throw new Error("Execution authority lacks host session binding");
  const artifactState = raw.installation?.status ?? raw.artifact?.state;
  if (!["active", "withdrawn", "security_revoked", "disabled"].includes(artifactState)) throw new Error("Execution authority lacks artifact state");
  return { execution, plan: { ...plan, planHash: raw.plan.plan_hash ?? raw.plan.planHash }, approval: { id: raw.approval.id, actorId: raw.approval.actor_id ?? raw.approval.actorId, expiresAt: new Date(raw.approval.expires_at ?? raw.approval.expiresAt).toISOString(), planHash: raw.approval.plan_hash ?? raw.approval.planHash }, authority: { actorEnabled: raw.actor.state === "enabled", hostSessionId, policyVersion: raw.plan.policy_version ?? plan.policyVersion, artifactState, approvalExpiresAt: new Date(raw.approval.expires_at ?? raw.approval.expiresAt).toISOString() }, pendingEffects, unknownEffects };
}
