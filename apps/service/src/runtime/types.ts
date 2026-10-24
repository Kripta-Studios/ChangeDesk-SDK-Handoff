import type { CapabilityId, MutationCapabilityId, PlanHashInput, PlannedEffect } from "@changedesk/contracts";
export type { Recipe } from "@changedesk/contracts";

export type Role = "admin" | "requester" | "operator" | "viewer";

export interface ActorContext {
  tenantId: string;
  actorId: string;
  hostSessionId: string;
  roles: readonly Role[];
  policyVersion: string;
  expiresAt: string;
}

export type Capability = CapabilityId;
export type EffectCapability = MutationCapabilityId;

export interface ProductSnapshot {
  id: string;
  status: string;
  blocked: boolean;
  categoryIds: readonly string[];
  channelIds: readonly string[];
  protectedDigest: string;
}
export type PlanEffect = PlannedEffect;
export type CompiledPlanBody = PlanHashInput;
export interface CompiledPlan extends PlanHashInput { planHash: string }
export interface JobLease {
  jobId: string; tenantId: string; actorId: string; backendKey: string; kind: "generation" | "execution" | "reconcile";
  executionId?: string; requestId?: string; leaseOwner: string; fence: number; leaseUntil: string; attemptCount: number;
}
export interface Attempt {
  attemptId: string;
  state: "intent_recorded" | "sent" | "confirmed" | "no_effect" | "rejected" | "unknown";
  operationKey: string; semanticInputHash: string;
}
export interface ExecutionBundle {
  execution: { id: string; planId: string; state: string; cancelRequestedAt?: string };
  plan: CompiledPlan;
  approval: { id: string; actorId: string; expiresAt: string; planHash: string };
  authority: { actorEnabled: boolean; policyVersion: string; artifactState: "active" | "withdrawn" | "security_revoked" | "disabled"; approvalExpiresAt: string };
  pendingEffects: readonly PlanEffect[];
  unknownEffects: readonly PlanEffect[];
}
export type WorkerOutcome =
  | { kind: "completed" } | { kind: "cancelled" }
  | { kind: "waiting_reconciliation"; reason: string }
  | { kind: "authority_expired"; observedEffects: number }
  | { kind: "failed"; reason: string };
export interface EffectCommand {
  tenantId: string; actorId: string; executionId: string; rowId: string; stepId: string; planId: string;
  planHash: string; planVersion: number; approvalId: string; approvalExpiresAt: string; operationKey: string;
  semanticInputHash: string; argsHash: string; fence: number; policyVersion: string; adapterVersion: string;
  capabilityManifestHash: string; capability: EffectCapability; args: Readonly<Record<string, string>>;
  preconditions: { productStatus: "published"; productUnlocked: true; relationAbsent: true; preconditionFingerprint: string };
}
export interface ReconcileCommand {
  tenantId: string; executionId: string; rowId: string; stepId: string; operationKey: string; semanticInputHash: string; argsHash: string;
  capability: EffectCapability;
}
export interface HostConnector {
  readAuthorized(command: { capability: Capability; args: unknown; actor: ActorContext }): Promise<unknown>;
  executeAuthorized(command: EffectCommand): Promise<{ receipt: unknown; observed: boolean }>;
  reconcileOperation(command: ReconcileCommand): Promise<{ state: "confirmed"; receipt: unknown } | { state: "no_effect" } | { state: "unknown" }>;
}
export interface EffectAuthority {
  authorizeEffectJustInTime(lease: JobLease, bundle: ExecutionBundle, effect: PlanEffect, now: Date): Promise<{ allowed: true } | { allowed: false; code: string }>;
}
