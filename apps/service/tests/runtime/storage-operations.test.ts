import { describe, expect, it, vi } from "vitest";
import { StorageApiOperations } from "../../src/api/storage-operations.js";
import { canonicalGenericRecipe } from "../../src/planner/publication.js";

const actor = { tenantId: "atlas", actorId: "operator", hostSessionId: "hs", roles: ["operator"], policyVersion: "p1", expiresAt: "2099-01-01T00:00:00Z" } as const;

describe("StorageApiOperations presentation DTOs", () => {
  it("maps authorized host resources to the SDK resource envelope without leaking host details", async () => {
    const connector = { readAuthorized: vi.fn().mockResolvedValue({ product_category: { id: "cat-1", name: "Summer" }, internal_note: "secret" }) };
    const operations = new StorageApiOperations({} as any, connector as any, { atlas: { category: ["cat-1"], channel: [] } });

    await expect(operations.getResources(actor, "category", { limit: 10 })).resolves.toEqual({ resources: [{ id: "cat-1", label: "Summer", kind: "category" }] });
  });

  it("returns policy permissions rather than role names", async () => {
    const store = { withTenant: vi.fn(async (_scope, work) => work({ listInstallationDetails: vi.fn().mockResolvedValue([]), getActiveCapabilityManifest: vi.fn().mockResolvedValue(null) })) };
    const operations = new StorageApiOperations(store as any, {} as any, {});

    const result = await operations.getInstallations(actor) as { permissions: string[]; identity: { actorName: string; scopeId: string }; offers: unknown[] };
    expect(result.permissions).toEqual(["read", "request", "preview", "approve", "execute"]);
    expect(result.permissions).not.toContain("operator");
    expect(result.identity).toMatchObject({ actorName: "operator", scopeId: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.offers).toEqual([]);
  });

  it("materializes an installed action plan without enqueueing a generation request", async () => {
    const createInstalledActionRequest = vi.fn().mockResolvedValue({ id: "audit-request" });
    const createPlan = vi.fn(async (input) => ({ id: input.id, state: input.state }));
    const tx = { getActiveCapabilityManifest: vi.fn().mockResolvedValue({ manifestHash: "b".repeat(64), body: { capabilityContract: "1", verifiedMedusaVersion: "2.22.1", capabilities: canonicalGenericRecipe("catalog.category.assign.v1").requiredCapabilities } }), getInstallationForPlan: vi.fn().mockResolvedValue({ installation: { id: "installation", status: "active" }, artifact: { artifactHash: "a".repeat(64), canonicalBody: canonicalGenericRecipe("catalog.category.assign.v1") } }), createInstalledActionRequest, createPlan, updateRequestState: vi.fn() };
    const store = { withTenant: vi.fn(async (_scope, work) => work(tx)) };
    const connector = { readAuthorized: vi.fn(async ({ args }) => "categoryId" in args ? { id: "category" } : { id: "product", status: "published", categories: [], sales_channels: [], protectedDigest: "c".repeat(64) }) };
    const operations = new StorageApiOperations(store as any, connector as any, { atlas: { category: ["category"], channel: [] } });

    const result = await operations.createPlan({ actor, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", requestHash: "d".repeat(64) }, { installationId: "installation", selectedProductIds: ["product"], parameters: { categoryId: "category" } });
    expect(result).toMatchObject({ status: "ready" });
    expect(createInstalledActionRequest).toHaveBeenCalledOnce();
    expect(createPlan).toHaveBeenCalledOnce();
  });
});
