import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildCoverageReport } from "../../apps/service/src/evals/coverage.js";
import { parseAttackCorpus } from "../../apps/service/src/evals/attack-corpus.js";

describe("ACC-013 attack coverage accounting", () => {
  it("accounts for every public case without converting unexecuted gates to PASS", async () => {
    const corpus = parseAttackCorpus(JSON.parse(await readFile(new URL("../../fixtures/attack-cases.json", import.meta.url), "utf8")));
    const report = buildCoverageReport(corpus.cases, []);
    expect(report.cases).toHaveLength(24);
    expect(report.cases.every(({ deterministic, live }) => deterministic.status !== "PASS" && live.status !== "PASS")).toBe(true);
    expect(report.summary).toMatchObject({ publicCases: 24, passedLanes: 0 });
  });
  it("rejects PASS without an executed independent-oracle observation", async () => {
    const corpus = parseAttackCorpus(JSON.parse(await readFile(new URL("../../fixtures/attack-cases.json", import.meta.url), "utf8")));
    expect(() => buildCoverageReport(corpus.cases, [{ caseId: "ATK-003", lane: "deterministic", status: "PASS", executed: false, independentOracle: false, evidence: [] }])).toThrow(/PASS.*executed.*oracle/i);
  });
});
