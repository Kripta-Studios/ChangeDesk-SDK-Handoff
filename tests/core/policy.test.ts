import { describe, expect, it } from "vitest";
import { authorize, authorizeApproval, evidenceStatusForProof, evaluateProofPolicy, permissionsForRole } from "../../apps/service/src/policy/index.js";

const operator = { tenantId: "atlas", actorId: "atlas.operator", role: "operator", enabled: true } as const;

describe("server policy", () => {
  it("implements the canonical role ceiling", () => {
    expect(permissionsForRole("viewer")).toEqual(["read"]);
    expect(permissionsForRole("requester")).not.toContain("approve");
    expect(permissionsForRole("operator")).toContain("execute");
    expect(permissionsForRole("admin")).toContain("policy.manage");
  });

  it("rejects cross-tenant resources without disclosing which resource exists", () => {
    expect(authorize({ actor: operator, tenantId: "atlas", requiredPermissions: ["execute"], requiredCapabilities: [], resourceTenantIds: ["atlas", "boreal"] })).toEqual({
      allowed: false,
      code: "scope_denied",
    });
  });

  it("rejects unknown capabilities and disabled actors", () => {
    expect(authorize({ actor: operator, tenantId: "atlas", requiredPermissions: ["execute"], requiredCapabilities: ["shell.exec" as any] })).toMatchObject({ allowed: false, code: "capability_unknown" });
    expect(authorize({ actor: { ...operator, enabled: false }, tenantId: "atlas", requiredPermissions: ["read"], requiredCapabilities: [] })).toMatchObject({ allowed: false, code: "actor_disabled" });
  });

  it("does not allow approval to amplify requester authority", () => {
    expect(authorize({ actor: { ...operator, role: "requester" }, tenantId: "atlas", requiredPermissions: ["approve"], requiredCapabilities: [] })).toMatchObject({ allowed: false, code: "permission_denied" });
    expect(authorize({ actor: { ...operator, role: "requester" }, tenantId: "atlas", requiredPermissions: [], requiredCapabilities: ["medusa.product_categories.products.add"] })).toMatchObject({ allowed: false, code: "permission_denied" });
  });

  it("allows an authorized same-tenant registered operation", () => {
    expect(authorize({ actor: operator, tenantId: "atlas", requiredPermissions: ["execute"], requiredCapabilities: ["medusa.product_categories.products.add"] })).toEqual({ allowed: true });
  });

  it("maps required proof absence/failure to a deterministic block", () => {
    expect(evidenceStatusForProof("verified")).toBe("passed");
    expect(evidenceStatusForProof("unavailable")).toBe("blocked");
    expect(evaluateProofPolicy({ proofRequired: true, evidenceStatus: "not_run" })).toEqual({ allowed: false, code: "proof_required" });
    expect(evaluateProofPolicy({ proofRequired: true, evidenceStatus: "passed" })).toEqual({ allowed: true });
    expect(evaluateProofPolicy({ proofRequired: false, evidenceStatus: "not_applicable" })).toEqual({ allowed: true });
  });

  it("binds approval to the exact actor, tenant, version and plan hash", () => {
    const plan = {
      id: "plan-1", tenantId: "atlas", actorId: "atlas.operator", planVersion: 2,
      planHash: "a".repeat(64), state: "ready", expiresAt: "2026-10-24T12:00:00.000Z",
    } as any;
    const request = { planId: "plan-1", planHash: "a".repeat(64), expectedPlanVersion: 2, idempotencyKey: "4f64c67e-6e68-4c0c-b4d8-baba928c6f20" };
    expect(authorizeApproval({ actor: operator, plan, request, now: new Date("2026-10-24T11:00:00.000Z") })).toEqual({ allowed: true });
    expect(authorizeApproval({ actor: { ...operator, actorId: "atlas.other" }, plan, request, now: new Date("2026-10-24T11:00:00.000Z") })).toEqual({ allowed: false, code: "actor_mismatch" });
    expect(authorizeApproval({ actor: operator, plan, request: { ...request, planHash: "b".repeat(64) }, now: new Date("2026-10-24T11:00:00.000Z") })).toEqual({ allowed: false, code: "stale_plan" });
    expect(authorizeApproval({ actor: operator, plan, request, now: new Date("2026-10-24T13:00:00.000Z") })).toEqual({ allowed: false, code: "plan_expired" });
  });
});
