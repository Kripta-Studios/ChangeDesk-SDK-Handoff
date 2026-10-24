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
      actor: { state: "enabled" }, installation: null, artifact: null, attempts: [],
    };
    const store = { withTenant: vi.fn(async (_scope, work) => work({ loadExecutionBundle: vi.fn().mockResolvedValue(raw) })) };
    const adapter = new StorageRuntimeAdapter(store as any, {} as any, { workerActorId: "worker", leaseSeconds: 30, globalCap: 1 });
    const lease: JobLease = { jobId: "j", tenantId: "atlas", actorId: "actor", backendKey: "atlas", kind: "execution", executionId: "e", leaseOwner: "w", fence: 1, leaseUntil: "2099-01-01T00:00:00Z", attemptCount: 1 };

    await expect(adapter.loadExecutionBundle(lease)).resolves.toMatchObject({ authority: { artifactState: "active" } });
  });
});
