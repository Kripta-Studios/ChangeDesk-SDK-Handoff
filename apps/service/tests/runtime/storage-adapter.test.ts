import { describe, expect, it, vi } from "vitest";
import { StorageRuntimeAdapter } from "../../src/runtime/storage-adapter.js";
import type { JobLease } from "../../src/runtime/types.js";

describe("StorageRuntimeAdapter", () => {
  it("maps the durable enabled actor state to live execution authority", async () => {
    const raw = {
      execution: { id: "e", plan_id: "p", state: "running" },
      plan: { body: { perRecordEffects: [] }, plan_hash: "a".repeat(64), policy_version: "pv" },
      approval: { id: "ap", actor_id: "actor", host_session_id: "hs", expires_at: new Date("2099-01-01T00:00:00Z"), plan_hash: "a".repeat(64) },
      actor: { state: "enabled" }, installation: { status: "active" }, attempts: [],
    };
    const store = { withTenant: vi.fn(async (_scope, work) => work({ loadExecutionBundle: vi.fn().mockResolvedValue(raw) })) };
    const adapter = new StorageRuntimeAdapter(store as any, {} as any, { workerActorId: "worker", leaseSeconds: 30, globalCap: 1 });
    const lease: JobLease = { jobId: "j", tenantId: "atlas", actorId: "actor", backendKey: "atlas", kind: "execution", executionId: "e", leaseOwner: "w", fence: 1, leaseUntil: "2099-01-01T00:00:00Z", attemptCount: 1 };

    const bundle = await adapter.loadExecutionBundle(lease);
    expect(bundle.authority.actorEnabled).toBe(true);
  });

  it("treats an actor-private direct plan as active without inventing an installation", async () => {
    const raw = {
      execution: { id: "e", plan_id: "p", state: "running" },
      plan: { installation_id: null, body: { perRecordEffects: [] }, plan_hash: "a".repeat(64), policy_version: "pv" },
      approval: { id: "ap", actor_id: "actor", host_session_id: "hs", expires_at: new Date("2099-01-01T00:00:00Z"), plan_hash: "a".repeat(64) },
      actor: { state: "enabled" }, installation: null, artifact: { state: "private" }, attempts: [],
    };
    const store = { withTenant: vi.fn(async (_scope, work) => work({ loadExecutionBundle: vi.fn().mockResolvedValue(raw) })) };
    const adapter = new StorageRuntimeAdapter(store as any, {} as any, { workerActorId: "worker", leaseSeconds: 30, globalCap: 1 });
    const lease: JobLease = { jobId: "j", tenantId: "atlas", actorId: "actor", backendKey: "atlas", kind: "execution", executionId: "e", leaseOwner: "w", fence: 1, leaseUntil: "2099-01-01T00:00:00Z", attemptCount: 1 };

    await expect(adapter.loadExecutionBundle(lease)).resolves.toMatchObject({ authority: { artifactState: "active" } });
  });

  it("fails closed when a direct plan has no concrete artifact row", async () => {
    const raw = {
      execution: { id: "e", plan_id: "p", state: "running" }, plan: { installation_id: null, body: { perRecordEffects: [] }, plan_hash: "a".repeat(64), policy_version: "pv" },
      approval: { id: "ap", actor_id: "actor", host_session_id: "hs", expires_at: new Date("2099-01-01T00:00:00Z"), plan_hash: "a".repeat(64) }, actor: { state: "enabled" }, installation: null, artifact: null, attempts: [],
    };
    const store = { withTenant: vi.fn(async (_scope, work) => work({ loadExecutionBundle: vi.fn().mockResolvedValue(raw) })) };
    const adapter = new StorageRuntimeAdapter(store as any, {} as any, { workerActorId: "worker", leaseSeconds: 30, globalCap: 1 });
    const lease: JobLease = { jobId: "j", tenantId: "atlas", actorId: "actor", backendKey: "atlas", kind: "execution", executionId: "e", leaseOwner: "w", fence: 1, leaseUntil: "2099-01-01T00:00:00Z", attemptCount: 1 };
    await expect(adapter.loadExecutionBundle(lease)).rejects.toThrow(/artifact state/);
  });

  it("maps a PostgreSQL JSON string plan body for direct-plan execution", async () => {
    const body = { actorId: "actor", selectionSnapshot: [{ productId: "p", preconditionFingerprint: "f" }], perRecordEffects: [], policyVersion: "pv" };
    const raw = { execution: { id: "e", plan_id: "p", state: "queued", revision: 0 }, plan: { installation_id: null, body: JSON.stringify(body), plan_hash: "a".repeat(64), policy_version: "pv" }, approval: { id: "ap", actor_id: "actor", host_session_id: "hs", expires_at: new Date("2099-01-01T00:00:00Z"), plan_hash: "a".repeat(64) }, actor: { state: "enabled" }, installation: null, artifact: { state: "private" }, attempts: [], rows: [] };
    const store = { withTenant: vi.fn(async (_scope, work) => work({ loadExecutionBundle: vi.fn().mockResolvedValue(raw) })) };
    const adapter = new StorageRuntimeAdapter(store as any, {} as any, { workerActorId: "worker", leaseSeconds: 30, globalCap: 1 });
    const stringLease: JobLease = { jobId: "j", tenantId: "atlas", actorId: "actor", backendKey: "atlas", kind: "execution", executionId: "e", leaseOwner: "w", fence: 1, leaseUntil: "2099-01-01T00:00:00Z", attemptCount: 1 };
    const loaded = await adapter.loadExecutionBundle(stringLease);
    expect(loaded.plan.selectionSnapshot).toEqual(body.selectionSnapshot);
  });
});
