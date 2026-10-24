import type { Attempt, ExecutionBundle, JobLease, WorkerOutcome } from "./types.js";
import type { EffectCapability } from "./types.js";

export interface RuntimeStorePort {
  recoverOrphanedLeases(limit?: number): Promise<number>;
  claimNextJob(workerId: string, now: Date): Promise<JobLease | null>;
  heartbeat(lease: JobLease, now: Date): Promise<boolean>;
  loadExecutionBundle(lease: JobLease): Promise<ExecutionBundle>;
  recordAttemptIntent(lease: JobLease, input: { rowId: string; stepId: string; operationKey: string; semanticInputHash: string; capability: EffectCapability; argsHash: string }): Promise<Attempt>;
  markAttemptSent(lease: JobLease, attemptId: string): Promise<boolean>;
  confirmAttempt(lease: JobLease, attemptId: string, receipt: unknown): Promise<boolean>;
  markAttemptUnknown(lease: JobLease, attemptId: string, code: string): Promise<boolean>;
  rejectAttempt(lease: JobLease, attemptId: string, code: string): Promise<boolean>;
  requeueOrFinish(lease: JobLease, outcome: WorkerOutcome): Promise<void>;
}
