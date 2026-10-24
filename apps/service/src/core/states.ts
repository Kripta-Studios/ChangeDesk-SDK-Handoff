import type { ExecutionState, PlanState, StepState } from "@changedesk/contracts";

const PLAN_TRANSITIONS: Readonly<Record<PlanState, readonly PlanState[]>> = {
  draft: ["validating", "expired", "superseded"],
  validating: ["ready", "rejected", "expired", "superseded"],
  ready: ["expired", "superseded"], rejected: [], expired: [], superseded: [],
};
const EXECUTION_TRANSITIONS: Readonly<Record<ExecutionState, readonly ExecutionState[]>> = {
  queued: ["running", "failed", "cancelled"],
  running: ["waiting_reconciliation", "succeeded", "partial", "failed", "cancelled"],
  waiting_reconciliation: ["running", "succeeded", "partial", "failed", "cancelled"],
  succeeded: [], partial: [], failed: [], cancelled: [],
};
const STEP_TRANSITIONS: Readonly<Record<StepState, readonly StepState[]>> = {
  pending: ["running", "skipped", "failed"],
  running: ["succeeded", "skipped", "unknown", "failed"],
  unknown: ["succeeded", "failed"], succeeded: [], skipped: [], failed: [],
};

export const canTransitionPlan = (from: PlanState, to: PlanState): boolean => PLAN_TRANSITIONS[from].includes(to);
export const canTransitionExecution = (from: ExecutionState, to: ExecutionState): boolean => EXECUTION_TRANSITIONS[from].includes(to);
export const canTransitionStep = (from: StepState, to: StepState): boolean => STEP_TRANSITIONS[from].includes(to);
