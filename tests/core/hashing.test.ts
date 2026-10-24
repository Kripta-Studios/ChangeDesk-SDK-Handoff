import { describe, expect, it } from "vitest";
import { artifactHash, canonicalizeJson, hashCanonical, planHash } from "../../apps/service/src/core/hashing.js";

describe("RFC 8785 canonical hashes", () => {
  it("matches the RFC 8785 primitive serialization vector", () => {
    expect(canonicalizeJson({
      literals: [null, true, false],
      numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 1e-27],
      string: "€$\u000f\nA'B\"\\\"/",
    })).toBe('{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\\"\\\\\\\"/"}');
  });

  it("is invariant to object insertion order and sensitive to domain", () => {
    expect(hashCanonical("artifact", "1", { b: 2, a: 1 })).toBe(hashCanonical("artifact", "1", { a: 1, b: 2 }));
    expect(hashCanonical("artifact", "1", { a: 1 })).not.toBe(hashCanonical("plan", "1", { a: 1 }));
  });

  it("rejects non-I-JSON values", () => {
    expect(() => canonicalizeJson({ n: Number.NaN })).toThrow(/finite/i);
    expect(() => canonicalizeJson({ s: "\ud800" })).toThrow(/surrogate/i);
    expect(() => canonicalizeJson({ ["\ud800"]: "invalid key" })).toThrow(/surrogate/i);
    expect(() => canonicalizeJson({ x: undefined } as any)).toThrow(/JSON/i);
    expect(() => canonicalizeJson(Array(1))).toThrow(/sparse/i);
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "x", { enumerable: true, get: () => 1 });
    expect(() => canonicalizeJson(accessor)).toThrow(/accessor/i);
  });

  it("does not include volatile publication metadata in artifact hashes", () => {
    const recipe = { schemaVersion: "1.0", recipeKey: "catalog.category.assign.v1" } as any;
    expect(artifactHash(recipe)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes explicitly semantic plan arrays without mutating the caller", () => {
    const base: any = {
      schemaVersion: "1", id: "p", planVersion: 1, tenantId: "atlas", actorId: "op", requestId: "r",
      artifactHash: "a".repeat(64), adapterVersion: "1", policyVersion: "1", capabilityManifestHash: "b".repeat(64),
      parameters: {}, selectionSnapshot: [{ productId: "p2", preconditionFingerprint: "2" }, { productId: "p1", preconditionFingerprint: "1" }],
      perRecordEffects: [], exclusions: [], limits: { maxRecords: 100, maxSteps: 12 }, expiresAt: "2026-10-24T10:00:00.000Z",
      evidenceRefs: ["e2", "e1"],
    };
    const reordered = structuredClone(base);
    reordered.selectionSnapshot.reverse();
    reordered.evidenceRefs.reverse();
    expect(planHash(base)).toBe(planHash(reordered));
    expect(base.selectionSnapshot[0].productId).toBe("p2");
  });
});
