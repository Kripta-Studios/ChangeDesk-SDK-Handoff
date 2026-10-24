import { describe, expect, it, vi } from "vitest";
import { DurableWorker } from "../../src/runtime/worker.js";
import { StrictEffectAuthority } from "../../src/runtime/authority.js";
import type { ExecutionBundle, JobLease, PlanEffect } from "../../src/runtime/types.js";

const lease: JobLease = { jobId: "j", tenantId: "atlas", actorId: "operator", backendKey: "atlas", kind: "execution", executionId: "e", leaseOwner: "w", fence: 2, leaseUntil: "2026-10-24T12:01:00.000Z", attemptCount: 1 };
const effect: PlanEffect = { recordId: "p01", stepId: "addCategory", capability: "medusa.product_categories.products.add", arguments: { productId: "p01", categoryId: "cat" }, expected: "apply", preconditionFingerprint: "d" };

describe("durable worker", () => {
  it("dispatches generation leases to the bounded planner processor", async () => {
    const generationLease = { ...lease, kind: "generation" as const, executionId: undefined, requestId: "r" };
    const store = fakeStore(bundle());
    store.claimNextJob.mockResolvedValue(generationLease);
    const generation = { process: vi.fn().mockResolvedValue({ kind: "completed" }) };
    const worker = new DurableWorker({ store: store as any, connector: {} as any, authority: new StrictEffectAuthority(), generation });

    expect(await worker.runOnce("w")).toEqual({ kind: "completed" });
    expect(generation.process).toHaveBeenCalledWith(generationLease, expect.any(AbortSignal));
    expect(store.loadExecutionBundle).not.toHaveBeenCalled();
    expect(store.requeueOrFinish).toHaveBeenCalledWith(generationLease, { kind: "completed" });
  });

  it("ACC-008 marks a lost effect response unknown and never retries it blindly", async () => {
    const store = fakeStore(bundle({ pendingEffects: [effect] }));
    const connector = { readAuthorized: vi.fn(), executeAuthorized: vi.fn().mockRejectedValue(new Error("socket lost")), reconcileOperation: vi.fn() };
    const worker = new DurableWorker({ store: store as any, connector, authority: new StrictEffectAuthority(), clock: () => new Date("2026-10-24T12:00:00Z") });
    expect(await worker.runOnce("w")).toEqual({ kind: "waiting_reconciliation", reason: "effect_unknown" });
    expect(store.markAttemptUnknown).toHaveBeenCalledOnce();
    expect(connector.executeAuthorized).toHaveBeenCalledOnce();
  });

  it("moves a queued execution and its rows through fenced business states", async () => {
    const queued = bundle({ execution: { id: "e", planId: "plan", state: "queued", revision: 0 }, pendingEffects: [effect] });
    const running = bundle({ execution: { id: "e", planId: "plan", state: "running", revision: 1 }, pendingEffects: [effect] });
    const store = fakeStore(queued);
    store.prepareExecution = vi.fn().mockResolvedValue(running);
    const connector = { readAuthorized: vi.fn(), executeAuthorized: vi.fn().mockResolvedValue({ observed: true, receipt: {} }), reconcileOperation: vi.fn() };
    const worker = new DurableWorker({ store: store as any, connector, authority: new StrictEffectAuthority(), clock: () => new Date("2026-10-24T12:00:00Z") });

    expect(await worker.runOnce("w")).toEqual({ kind: "completed" });
    expect(store.prepareExecution).toHaveBeenCalledWith(lease, queued);
    expect(store.updateRowState).toHaveBeenNthCalledWith(1, lease, "p01", "running");
    expect(store.updateRowState).toHaveBeenNthCalledWith(2, lease, "p01", "succeeded");
    expect(store.settleExecution).toHaveBeenCalledWith(lease, { kind: "completed" });
  });

  it("ACC-020 expired authority reconciles exact unknown operation and causes no new effect", async () => {
    const expired = bundle({ pendingEffects: [effect], unknownEffects: [effect], approval: { id: "ap", actorId: "operator", expiresAt: "2026-10-24T11:59:00Z", planHash: "h" } });
    const store = fakeStore(expired);
    const connector = { readAuthorized: vi.fn(), executeAuthorized: vi.fn(), reconcileOperation: vi.fn().mockResolvedValue({ state: "confirmed", receipt: { id: "r" } }) };
    const worker = new DurableWorker({ store: store as any, connector, authority: new StrictEffectAuthority(), clock: () => new Date("2026-10-24T12:00:00Z") });
    expect(await worker.runOnce("w")).toEqual({ kind: "authority_expired", observedEffects: 1 });
    expect(connector.reconcileOperation).toHaveBeenCalledOnce();
    expect(connector.executeAuthorized).not.toHaveBeenCalled();
  });

  it("ACC-009 stale fence cannot confirm progress", async () => {
    const store = fakeStore(bundle({ pendingEffects: [effect] }));
    store.confirmAttempt.mockResolvedValue(false);
    const connector = { readAuthorized: vi.fn(), executeAuthorized: vi.fn().mockResolvedValue({ observed: true, receipt: {} }), reconcileOperation: vi.fn() };
    const worker = new DurableWorker({ store: store as any, connector, authority: new StrictEffectAuthority(), clock: () => new Date("2026-10-24T12:00:00Z") });
    expect(await worker.runOnce("w")).toEqual({ kind: "waiting_reconciliation", reason: "lease_lost_after_send" });
  });
});

function fakeStore(value: ExecutionBundle) { return { recoverOrphanedLeases: vi.fn().mockResolvedValue(0), claimNextJob: vi.fn().mockResolvedValue(lease), heartbeat: vi.fn().mockResolvedValue(true), loadExecutionBundle: vi.fn().mockResolvedValue(value), prepareExecution: vi.fn().mockResolvedValue(value), updateRowState: vi.fn().mockResolvedValue(true), settleExecution: vi.fn().mockResolvedValue(true), recordAttemptIntent: vi.fn().mockResolvedValue({ attemptId: "a", state: "intent_recorded" }), markAttemptSent: vi.fn().mockResolvedValue(true), confirmAttempt: vi.fn().mockResolvedValue(true), markAttemptUnknown: vi.fn().mockResolvedValue(true), rejectAttempt: vi.fn().mockResolvedValue(true), requeueOrFinish: vi.fn().mockResolvedValue(undefined) }; }
function bundle(overrides: Partial<ExecutionBundle> = {}): ExecutionBundle {
  return { execution: { id: "e", planId: "plan", state: "running", revision: 1 }, plan: { schemaVersion: "1.0", id: "plan", tenantId: "atlas", actorId: "operator", requestId: "r", artifactHash: "a".repeat(64), adapterVersion: "v", policyVersion: "p", capabilityManifestHash: "c".repeat(64), parameters: {}, selectionSnapshot: [], perRecordEffects: [], exclusions: [], limits: { maxRecords: 100, maxSteps: 12 }, expiresAt: "2026-10-24T12:05:00Z", evidenceRefs: [], planVersion: 1, planHash: "h" }, approval: { id: "ap", actorId: "operator", expiresAt: "2026-10-24T12:05:00Z", planHash: "h" }, authority: { actorEnabled: true, hostSessionId: "hs", policyVersion: "p", artifactState: "active", approvalExpiresAt: "2026-10-24T12:05:00Z" }, pendingEffects: [], unknownEffects: [], ...overrides };
}
