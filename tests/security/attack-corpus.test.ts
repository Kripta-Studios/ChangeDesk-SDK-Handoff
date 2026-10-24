import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseAttackCorpus } from "../../apps/service/src/evals/attack-corpus.js";

describe("ACC-013 public adversarial corpus", () => {
  it("loads all 24 uniquely identified public regression cases without treating them as holdout", async () => {
    const raw = JSON.parse(await readFile(new URL("../../fixtures/attack-cases.json", import.meta.url), "utf8"));
    const corpus = parseAttackCorpus(raw);
    expect(corpus.cases).toHaveLength(24);
    expect(new Set(corpus.cases.map(({ id }) => id)).size).toBe(24);
    expect(corpus.cases.map(({ id }) => id)).toEqual(Array.from({ length: 24 }, (_, i) => `ATK-${String(i + 1).padStart(3, "0")}`));
    expect(corpus.cases.every(({ split }) => split === "public-regression")).toBe(true);
    expect(corpus.isHoldout).toBe(false);
  });

  it("rejects a corpus that weakens the independent oracle contract", () => {
    expect(() => parseAttackCorpus({ schemaVersion: "1.0", status: "specification-not-executed", canonicalRecipe: "x", tenants: [], notes: [], cases: [{ id: "ATK-001", family: "x", surface: "x", legitimateTask: "x", manipulation: "x", expected: "x", invariants: ["SEC-AUTHZ"], gate: "deterministic", split: "public-regression", syntheticOnly: true, cleanPairRequired: true, oracle: "model self-report" }] })).toThrow(/oracle/i);
  });
});
