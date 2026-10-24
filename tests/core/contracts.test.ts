import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createContractValidator, validateIdempotencyMatch } from "../../apps/service/src/core/validation.js";
import { approvalRequestSchema, recipeSchema, requestSchema } from "../../packages/contracts/src/schemas.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve("contracts", name), "utf8"));

describe("closed developer-owned contracts", () => {
  const validator = createContractValidator();

  it.each([
    ["recipe.schema.json", recipeSchema],
    ["request.schema.json", requestSchema],
    ["approval-request.schema.json", approvalRequestSchema],
  ])("keeps packaged %s equal to the normative root contract", (name, packaged) => {
    expect(packaged).toEqual(fixture(name));
    const blob = (path: string): string => execFileSync("git", ["hash-object", path], { encoding: "utf8" }).trim();
    expect(blob(resolve("packages/contracts/schemas", name))).toBe(blob(resolve("contracts", name)));
  });

  for (const name of [
    "recipe.example.json",
    "category-recipe.example.json",
    "channel-recipe.example.json",
  ]) {
    it(`accepts the normative ${name}`, () => {
      expect(validator.validateRecipe(fixture(name))).toMatchObject({ ok: true });
    });
  }

  it.each([
    ["unknown top-level keys", { injected: true }],
    ["untrusted proofRequired", { proofRequired: false }],
  ])("rejects %s", (_label, extra) => {
    expect(validator.validateRecipe({ ...fixture("recipe.example.json") as object, ...extra })).toMatchObject({ ok: false });
  });

  it("rejects executable and unknown operations before they become work", () => {
    const recipe = structuredClone(fixture("category-recipe.example.json")) as any;
    recipe.steps[0].capability = "shell.exec";
    recipe.steps[0].arguments = { command: "rm", productId: { $record: "id" } };
    expect(validator.validateRecipe(recipe)).toMatchObject({ ok: false });
  });

  it("enforces exact recipe forms and capability closure", () => {
    const recipe = structuredClone(fixture("category-recipe.example.json")) as any;
    recipe.recipeKey = "catalog.campaign.prepare.v1";
    expect(validator.validateRecipe(recipe)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "recipe.form" })]),
    });
  });

  it("rejects duplicate, forward, self and unknown dependencies", () => {
    const duplicate = structuredClone(fixture("recipe.example.json")) as any;
    duplicate.steps[1].id = duplicate.steps[0].id;
    expect(validator.validateRecipe(duplicate)).toMatchObject({ ok: false });

    for (const dependency of ["addChannel", "missing"]) {
      const invalid = structuredClone(fixture("recipe.example.json")) as any;
      invalid.steps[0].dependsOn = [dependency];
      expect(validator.validateRecipe(invalid)).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([expect.objectContaining({ code: "recipe.dependency" })]),
      });
    }
  });

  it("rejects wrong argument reference types and unused UI parameters", () => {
    const wrongRef = structuredClone(fixture("category-recipe.example.json")) as any;
    wrongRef.steps[0].arguments.categoryId = { $param: "channelId" };
    expect(validator.validateRecipe(wrongRef)).toMatchObject({ ok: false });

    const unused = structuredClone(fixture("category-recipe.example.json")) as any;
    unused.parameters.channelId = { kind: "resource", resource: "medusa.sales_channel" };
    unused.ui.fields.push({ name: "channelId", control: "resource-picker", label: "Canal" });
    expect(validator.validateRecipe(unused)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "recipe.parameters" })]),
    });
  });

  it("returns a detached deeply frozen recipe", () => {
    const input = fixture("recipe.example.json") as any;
    const result = validator.validateRecipe(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.steps[0])).toBe(true);
    input.displayName = "mutated";
    expect(result.value.displayName).toBe("Preparar campaña");
  });

  it("rejects browser authority fields, duplicate selection and malformed UUIDs", () => {
    const base = { message: "ok", selectedProductIds: ["p1"], clientRequestId: "4f64c67e-6e68-4c0c-b4d8-baba928c6f20" };
    expect(validator.validateRequest({ ...base, tenantId: "atlas" })).toMatchObject({ ok: false });
    expect(validator.validateRequest({ ...base, selectedProductIds: ["p1", "p1"] })).toMatchObject({ ok: false });
    expect(validator.validateRequest({ ...base, clientRequestId: "not-a-uuid" })).toMatchObject({ ok: false });
    expect(validator.validateRequest(base)).toMatchObject({ ok: true });
  });

  it("binds approval syntax to a hash, positive version and UUID", () => {
    const valid = {
      planId: "plan-1",
      planHash: "a".repeat(64),
      expectedPlanVersion: 1,
      idempotencyKey: "4f64c67e-6e68-4c0c-b4d8-baba928c6f20",
    };
    expect(validator.validateApprovalRequest(valid)).toMatchObject({ ok: true });
    expect(validator.validateApprovalRequest({ ...valid, planHash: "A".repeat(64) })).toMatchObject({ ok: false });
    expect(validateIdempotencyMatch(undefined, valid.idempotencyKey)).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: "idempotency.missing" })] });
    expect(validateIdempotencyMatch("1af4a151-9162-4ad6-8d7f-87ac59bcb3a2", valid.idempotencyKey)).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: "idempotency.mismatch" })] });
    expect(validateIdempotencyMatch(valid.idempotencyKey, valid.idempotencyKey)).toEqual({ ok: true, value: valid.idempotencyKey });
  });
});
