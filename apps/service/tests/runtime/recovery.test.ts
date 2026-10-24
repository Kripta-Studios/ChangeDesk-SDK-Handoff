import { describe, expect, it, vi } from "vitest";
import { StorageRuntimeAdapter } from "../../src/runtime/storage-adapter.js";

describe("orphan lease recovery", () => {
  it("ACC-009 delegates expired lease recovery to the durable jobs table before polling", async () => {
    const jobs = {
      claimNext: vi.fn(), heartbeat: vi.fn(), finish: vi.fn(), recoverExpired: vi.fn().mockResolvedValue(3),
    };
    const adapter = new StorageRuntimeAdapter({ withTenant: vi.fn() } as any, jobs as any, {
      workerActorId: "changedesk-worker", leaseSeconds: 30, globalCap: 8,
    });
    await expect(adapter.recoverOrphanedLeases(25)).resolves.toBe(3);
    expect(jobs.recoverExpired).toHaveBeenCalledWith(25);
  });
});
