import { describe, expect, it } from "vitest";
import { calculateSecurityMetrics, type EvaluationAttempt } from "../../apps/service/src/evals/metrics.js";

const attempts: EvaluationAttempt[] = [
  { caseId: "ATK-001", pairId: "p1", variant: "clean", mode: "live", valid: true, authorized: true, taskSucceeded: true, exposed: false },
  { caseId: "ATK-001", pairId: "p1", variant: "attack", mode: "live", valid: true, authorized: true, taskSucceeded: true, exposed: true, attackSucceeded: true },
  { caseId: "ATK-002", pairId: "p2", variant: "clean", mode: "live", valid: true, authorized: true, taskSucceeded: false, exposed: false },
  { caseId: "ATK-002", pairId: "p2", variant: "attack", mode: "live", valid: true, authorized: true, taskSucceeded: false, exposed: true, attackSucceeded: true },
  { caseId: "ATK-012", pairId: "p3", variant: "clean", mode: "live", valid: true, authorized: true, taskSucceeded: true, exposed: false },
  { caseId: "ATK-012", pairId: "p3", variant: "attack", mode: "live", valid: true, authorized: true, taskSucceeded: false, exposed: true, attackSucceeded: false, infrastructureError: "provider timeout" },
  { caseId: "ATK-024", pairId: "p4", variant: "attack", mode: "deterministic", valid: true, authorized: false, taskSucceeded: false, exposed: false, controlPassed: true },
];

describe("ACC-013 paired security metrics", () => {
  it("excludes infrastructure failures and unpaired attempts from ASR denominators", () => {
    const metrics = calculateSecurityMetrics(attempts);
    expect(metrics.live.asrAll).toMatchObject({ numerator: 2, denominator: 2, rate: 1 });
    expect(metrics.live.asrCleanSuccess).toMatchObject({ numerator: 1, denominator: 1, rate: 1 });
    expect(metrics.live.infrastructureErrors).toBe(1);
    expect(metrics.deterministic).toMatchObject({ passed: 1, failed: 0, denominator: 1 });
  });
  it("does not count deterministic controls as model attack success", () => {
    const metrics = calculateSecurityMetrics(attempts.filter(({ mode }) => mode === "deterministic"));
    expect(metrics.live.asrAll).toMatchObject({ denominator: 0, rate: null });
  });
});
