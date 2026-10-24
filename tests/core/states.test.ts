import { describe, expect, it } from "vitest";
import { canTransitionExecution, canTransitionPlan, canTransitionStep } from "../../apps/service/src/core/states.js";

describe("canonical state transitions", () => {
  it("permits specified forward transitions", () => {
    expect(canTransitionPlan("draft", "validating")).toBe(true);
    expect(canTransitionPlan("validating", "ready")).toBe(true);
    expect(canTransitionExecution("running", "waiting_reconciliation")).toBe(true);
    expect(canTransitionStep("running", "unknown")).toBe(true);
  });

  it("rejects resurrection and invented shortcuts", () => {
    expect(canTransitionPlan("rejected", "ready")).toBe(false);
    expect(canTransitionExecution("succeeded", "running")).toBe(false);
    expect(canTransitionExecution("queued", "succeeded")).toBe(false);
    expect(canTransitionStep("unknown", "pending")).toBe(false);
  });
});
