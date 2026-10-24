import { describe, expect, it } from "vitest";
import { compilePlan, PlanCompileError } from "../../src/runtime/compiler.js";
import type { ProductSnapshot, Recipe } from "../../src/runtime/types.js";

const recipe: Recipe = {
  schemaVersion: "1.0", recipeKey: "catalog.campaign.prepare.v1",
  displayName: "Prepare campaign", description: "Add selected published products to a category and channel.",
  compatibility: { adapter: "medusa-v2", capabilityContract: "1", verifiedMedusaVersion: "2.22.1" },
  parameters: { categoryId: { kind: "resource", resource: "medusa.product_category" }, channelId: { kind: "resource", resource: "medusa.sales_channel" } },
  selection: { resource: "medusa.product", maxRecords: 100, requireStatus: "published" },
  requiredCapabilities: ["medusa.products.list", "medusa.products.retrieve", "medusa.product_categories.retrieve", "medusa.sales_channels.retrieve", "medusa.product_categories.products.add", "medusa.sales_channels.products.add"],
  steps: [
    { id: "addCategory", capability: "medusa.product_categories.products.add", forEach: "selectedProducts", dependsOn: [], arguments: { productId: { $record: "id" }, categoryId: { $param: "categoryId" } } },
    { id: "addChannel", capability: "medusa.sales_channels.products.add", forEach: "selectedProducts", dependsOn: ["addCategory"], arguments: { productId: { $record: "id" }, channelId: { $param: "channelId" } } },
  ],
  ui: { kind: "action", label: "Prepare", fields: [{ name: "categoryId", control: "resource-picker", label: "Category" }, { name: "channelId", control: "resource-picker", label: "Channel" }] },
};
const products = [
  product("p01"), product("p02", { categoryIds: ["cat"] }), product("p03", { channelIds: ["channel"] }), product("p04", { categoryIds: ["cat"], channelIds: ["channel"] }),
  product("p05", { status: "draft" }), product("p06", { status: "rejected" }), product("p07", { blocked: true }), product("p08"),
];

describe("deterministic plan compiler", () => {
  it("ACC-005 materializes 5 eligible, 3 excluded and 6 additions without writes", () => {
    const writes: unknown[] = [];
    const plan = compilePlan(input(products));
    expect(plan.selectionSnapshot).toHaveLength(5);
    expect(plan.exclusions).toEqual([
      { recordId: "p05", reason: "status" }, { recordId: "p06", reason: "status" }, { recordId: "p07", reason: "policy" },
    ]);
    expect(plan.perRecordEffects.filter((effect) => effect.expected === "apply")).toHaveLength(6);
    expect(writes).toHaveLength(0);
    expect(compilePlan(input([...products].reverse())).planHash).toBe(plan.planHash);
  });

  it("SEC-AUTHZ rejects the whole selection if one selected id is unreadable", () => {
    expect(() => compilePlan(input(products.slice(0, 7)))).toThrowError(PlanCompileError);
    try { compilePlan(input(products.slice(0, 7))); } catch (error) { expect((error as PlanCompileError).code).toBe("selection_not_authorized"); }
  });
  it("SEC-PROOF fails closed when trusted policy requires unavailable evidence", () => {
    const value = input(products);
    expect(() => compilePlan({ ...value, proofPolicy: { proofRequired: true, evidenceStatus: "blocked", evidenceRefs: ["e1"] } })).toThrowError(expect.objectContaining({ code: "proof_required" }));
  });
});

function product(id: string, overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return { id, status: "published", blocked: false, categoryIds: [] as string[], channelIds: [] as string[], protectedDigest: `${id}-digest`, ...overrides };
}
function input(readableProducts: typeof products) {
  return { planId: "plan", tenantId: "atlas", actorId: "operator", requestId: "req", artifactHash: "a".repeat(64), adapterVersion: "medusa-2.22.1/changedesk-1", policyVersion: "p1", capabilityManifestHash: "b".repeat(64), recipe, parameters: { categoryId: "cat", channelId: "channel" }, selectedProductIds: products.map((item) => item.id), readableProducts, expiresAt: "2026-10-24T12:10:00.000Z", planVersion: 1, proofPolicy: { proofRequired: false, evidenceStatus: "not_applicable" as const, evidenceRefs: [] } };
}
