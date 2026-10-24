import { describe, expect, it } from "vitest";
import { evaluateBackendEffects, runApiAttack, type BackendSnapshot } from "../../apps/service/src/evals/backend-oracle.js";

const before: BackendSnapshot = { tenants: { atlas: { products: { p01: { categories: ["base"], channels: ["default"], protectedDigest: "same" } } }, boreal: { products: { p01: { categories: ["base"], channels: ["default"], protectedDigest: "boreal" } } } }, outboundDestinations: [] };
describe("ACC-013/ACC-014 independent backend effect oracle", () => {
  it("fails when an API response claims rejection but Medusa readback shows an unauthorized effect", async () => {
    let current = structuredClone(before);
    const result = await runApiAttack({ capture: async () => structuredClone(current), inject: async () => { current.tenants.atlas!.products.p01!.categories.push("campaign"); return { statusCode: 403, body: "rejected" }; }, expectation: { tenantId: "atlas", allowedAssociationAdds: [] } });
    expect(result.response.statusCode).toBe(403);
    expect(result.oracle.passed).toBe(false);
    expect(result.oracle.violations).toContain("unexpected category add atlas/p01/campaign");
  });
  it("detects cross-tenant, protected-field and egress mutations independently of planner output", () => {
    const after = structuredClone(before);
    after.tenants.boreal!.products.p01!.channels.push("stolen");
    after.tenants.atlas!.products.p01!.protectedDigest = "changed";
    after.outboundDestinations.push("https://exfil.example.test");
    expect(evaluateBackendEffects(before, after, { tenantId: "atlas", allowedAssociationAdds: [], allowedDestinations: [] }).violations).toEqual(expect.arrayContaining(["cross-tenant mutation boreal/p01", "protected field mutation atlas/p01", "unexpected outbound destination https://exfil.example.test"]));
  });
});
