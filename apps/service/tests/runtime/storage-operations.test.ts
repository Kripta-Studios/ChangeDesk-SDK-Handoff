import { describe, expect, it, vi } from "vitest";
import { StorageApiOperations } from "../../src/api/storage-operations.js";

const actor = { tenantId: "atlas", actorId: "operator", hostSessionId: "hs", roles: ["operator"], policyVersion: "p1", expiresAt: "2099-01-01T00:00:00Z" } as const;

describe("StorageApiOperations presentation DTOs", () => {
  it("maps authorized host resources to the SDK resource envelope without leaking host details", async () => {
    const connector = { readAuthorized: vi.fn().mockResolvedValue({ product_category: { id: "cat-1", name: "Summer" }, internal_note: "secret" }) };
    const operations = new StorageApiOperations({} as any, connector as any, { atlas: { category: ["cat-1"], channel: [] } });

    await expect(operations.getResources(actor, "category", { limit: 10 })).resolves.toEqual({ resources: [{ id: "cat-1", label: "Summer", kind: "category" }] });
  });

  it("returns policy permissions rather than role names", async () => {
    const store = { withTenant: vi.fn(async (_scope, work) => work({ listInstallationDetails: vi.fn().mockResolvedValue([]) })) };
    const operations = new StorageApiOperations(store as any, {} as any, {});

    const result = await operations.getInstallations(actor) as { permissions: string[] };
    expect(result.permissions).toEqual(["read", "request", "preview", "approve", "execute"]);
    expect(result.permissions).not.toContain("operator");
  });
});
