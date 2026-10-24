import { hashCanonical, semanticInputHash } from "../core/hashing.js";
import type { EffectAuthority, ExecutionBundle, HostConnector, JobLease, PlanEffect, WorkerOutcome } from "./types.js";
import type { RuntimeStorePort } from "./store-port.js";
import type { GenerationProcessor } from "../planner/generation-worker.js";

export class ConnectorError extends Error {
  constructor(public readonly code: string, public readonly certainty: "not_sent" | "unknown", message: string) { super(message); }
}

export interface WorkerDependencies {
  store: RuntimeStorePort;
  connector: HostConnector;
  authority: EffectAuthority;
  generation?: GenerationProcessor;
  clock?: () => Date;
}

export class DurableWorker {
  readonly #clock: () => Date;
  constructor(private readonly dependencies: WorkerDependencies) { this.#clock = dependencies.clock ?? (() => new Date()); }
  recoverOrphanedLeases(limit = 100): Promise<number> { return this.dependencies.store.recoverOrphanedLeases(limit); }

  async runOnce(workerId: string, signal?: AbortSignal): Promise<"idle" | WorkerOutcome> {
    const lease = await this.dependencies.store.claimNextJob(workerId, this.#clock());
    if (!lease) return "idle";
    if (!await this.dependencies.store.heartbeat(lease, this.#clock())) return { kind: "waiting_reconciliation", reason: "lease_lost_before_load" };
    if (lease.kind === "generation" && this.dependencies.generation) {
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason); signal?.addEventListener("abort", abort, { once: true });
      let leaseLost = false, heartbeatRunning = false;
      const intervalMs = Math.max(1_000, Math.min(10_000, Math.floor((Date.parse(lease.leaseUntil) - this.#clock().getTime()) / 3)));
      const timer = setInterval(() => { if (heartbeatRunning) return; heartbeatRunning = true; void this.dependencies.store.heartbeat(lease, this.#clock()).then((alive) => { if (!alive) { leaseLost = true; controller.abort(); } }).finally(() => { heartbeatRunning = false; }); }, intervalMs);
      const outcome = await this.dependencies.generation.process(lease, controller.signal).finally(() => { clearInterval(timer); signal?.removeEventListener("abort", abort); });
      if (leaseLost) return { kind: "waiting_reconciliation", reason: "generation_lease_lost" };
      await this.dependencies.store.requeueOrFinish(lease, outcome);
      return outcome;
    }
    if (lease.kind !== "execution" && lease.kind !== "reconcile") {
      const outcome = { kind: "failed", reason: "unsupported_job_kind" } as const;
      await this.dependencies.store.requeueOrFinish(lease, outcome);
      return outcome;
    }
    const loaded = await this.dependencies.store.loadExecutionBundle(lease);
    const prepared = await this.dependencies.store.prepareExecution(lease, loaded);
    if (!prepared) return { kind: "waiting_reconciliation", reason: "lease_lost_before_execution_start" };
    const outcome = await this.#runExecution(lease, prepared);
    if (!await this.dependencies.store.settleExecution(lease, outcome)) return { kind: "waiting_reconciliation", reason: "lease_lost_before_execution_settlement" };
    await this.dependencies.store.requeueOrFinish(lease, outcome);
    return outcome;
  }

  async #runExecution(lease: JobLease, bundle: ExecutionBundle): Promise<WorkerOutcome> {
    const reconciliation = await this.#reconcileUnknown(lease, bundle);
    if (reconciliation.unknown > 0) return { kind: "waiting_reconciliation", reason: "effect_still_unknown" };
    if (bundle.execution.cancelRequestedAt) return { kind: "cancelled" };

    const currentAuthority = await this.#authorityForNext(lease, bundle);
    if (!currentAuthority.allowed) return { kind: "authority_expired", observedEffects: reconciliation.confirmed };
    if (lease.kind === "reconcile") return { kind: "completed" };

    for (const effect of bundle.pendingEffects) {
      if (!await this.dependencies.store.heartbeat(lease, this.#clock())) return { kind: "waiting_reconciliation", reason: "lease_lost_before_effect" };
      const authority = await this.dependencies.authority.authorizeEffectJustInTime(lease, bundle, effect, this.#clock());
      if (!authority.allowed) return { kind: "authority_expired", observedEffects: reconciliation.confirmed };
      const outcome = await this.#executeEffect(lease, bundle, effect);
      if (outcome) return outcome;
    }
    return { kind: "completed" };
  }

  async #authorityForNext(lease: JobLease, bundle: ExecutionBundle) {
    const effect = bundle.pendingEffects[0] ?? bundle.unknownEffects[0];
    return effect ? this.dependencies.authority.authorizeEffectJustInTime(lease, bundle, effect, this.#clock()) : { allowed: true as const };
  }

  async #reconcileUnknown(lease: JobLease, bundle: ExecutionBundle): Promise<{ confirmed: number; unknown: number }> {
    let confirmed = 0;
    let unknown = 0;
    for (const effect of bundle.unknownEffects) {
      const hashes = effectHashes(bundle, effect);
      const attempt = await this.dependencies.store.recordAttemptIntent(lease, { rowId: effect.recordId, stepId: effect.stepId, capability: effect.capability, ...hashes });
      if (!attempt) return { confirmed, unknown: unknown + 1 };
      const result = await this.dependencies.connector.reconcileOperation({ tenantId: lease.tenantId, executionId: bundle.execution.id, rowId: effect.recordId, stepId: effect.stepId, capability: effect.capability, ...hashes });
      if (result.state === "confirmed") {
        if (!await this.dependencies.store.confirmAttempt(lease, attempt.attemptId, result.receipt)) return { confirmed, unknown: unknown + 1 };
        if (!await this.dependencies.store.updateRowState(lease, effect.recordId, "succeeded")) return { confirmed, unknown: unknown + 1 };
        confirmed++;
      } else if (result.state === "no_effect") {
        if (!await this.dependencies.store.markAttemptNoEffect(lease, attempt.attemptId)) return { confirmed, unknown: unknown + 1 };
        if (!await this.dependencies.store.updateRowState(lease, effect.recordId, "succeeded")) return { confirmed, unknown: unknown + 1 };
      } else {
        unknown++;
      }
    }
    return { confirmed, unknown };
  }

  async #executeEffect(lease: JobLease, bundle: ExecutionBundle, effect: PlanEffect): Promise<WorkerOutcome | undefined> {
    if (!await this.dependencies.store.updateRowState(lease, effect.recordId, "running")) return { kind: "waiting_reconciliation", reason: "lease_lost_before_row_start" };
    const hashes = effectHashes(bundle, effect);
    const attempt = await this.dependencies.store.recordAttemptIntent(lease, { rowId: effect.recordId, stepId: effect.stepId, capability: effect.capability, ...hashes });
    if (!attempt) return { kind: "waiting_reconciliation", reason: "lease_lost_before_intent" };
    if (attempt.state === "confirmed" || attempt.state === "no_effect") return;
    if (attempt.state === "sent" || attempt.state === "unknown") return { kind: "waiting_reconciliation", reason: "existing_uncertain_attempt" };
    if (attempt.state === "rejected") return { kind: "failed", reason: "existing_rejected_attempt" };
    if (!await this.dependencies.store.markAttemptSent(lease, attempt.attemptId)) return { kind: "waiting_reconciliation", reason: "lease_lost_before_send" };
    try {
      const result = await this.dependencies.connector.executeAuthorized({
        tenantId: lease.tenantId, actorId: bundle.plan.actorId, hostSessionId: bundle.authority.hostSessionId, executionId: bundle.execution.id,
        rowId: effect.recordId, stepId: effect.stepId, planId: bundle.execution.planId, planHash: bundle.plan.planHash,
        planVersion: bundle.plan.planVersion, approvalId: bundle.approval.id, approvalExpiresAt: Math.floor(Date.parse(bundle.approval.expiresAt) / 1000),
        jobId: lease.jobId, leaseOwner: lease.leaseOwner, fence: lease.fence, policyVersion: bundle.plan.policyVersion, adapterVersion: bundle.plan.adapterVersion,
        capabilityManifestHash: bundle.plan.capabilityManifestHash, capability: effect.capability, args: effect.arguments,
        preconditions: { productStatus: "published", productUnlocked: true, relationAbsent: true, preconditionFingerprint: effect.preconditionFingerprint }, ...hashes,
      });
      if (!result.observed) {
        await this.dependencies.store.markAttemptUnknown(lease, attempt.attemptId, "readback_not_observed");
        await this.dependencies.store.updateRowState(lease, effect.recordId, "unknown");
        return { kind: "waiting_reconciliation", reason: "readback_not_observed" };
      }
      if (!await this.dependencies.store.confirmAttempt(lease, attempt.attemptId, result.receipt)) return { kind: "waiting_reconciliation", reason: "lease_lost_after_send" };
      if (!await this.dependencies.store.updateRowState(lease, effect.recordId, "succeeded")) return { kind: "waiting_reconciliation", reason: "lease_lost_after_row_success" };
    } catch (error) {
      if (error instanceof ConnectorError && error.certainty === "not_sent") {
        await this.dependencies.store.rejectAttempt(lease, attempt.attemptId, error.code);
        await this.dependencies.store.updateRowState(lease, effect.recordId, "failed");
        return { kind: "failed", reason: error.code };
      }
      await this.dependencies.store.markAttemptUnknown(lease, attempt.attemptId, error instanceof ConnectorError ? error.code : "connector_unknown");
      await this.dependencies.store.updateRowState(lease, effect.recordId, "unknown");
      return { kind: "waiting_reconciliation", reason: "effect_unknown" };
    }
  }
}

function effectHashes(bundle: ExecutionBundle, effect: PlanEffect) {
  const inputHash = semanticInputHash({ executionId: bundle.execution.id, rowId: effect.recordId, stepId: effect.stepId, capability: effect.capability, arguments: effect.arguments, expected: effect.expected, preconditionFingerprint: effect.preconditionFingerprint });
  return {
    operationKey: `${bundle.execution.id}:${effect.recordId}:${effect.stepId}:${inputHash}`,
    semanticInputHash: inputHash,
    argsHash: hashCanonical("bridge-arguments", "1", effect.arguments),
  };
}
