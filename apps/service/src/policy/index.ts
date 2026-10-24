import type { ActorContext, ActorRole, ApprovalRequestInput, CapabilityId, EvidenceStatus, Permission, Plan, ProofResultStatus } from "@changedesk/contracts";
import { CAPABILITY_MANIFEST, isCapabilityId } from "../core/capabilities.js";

const ROLE_PERMISSIONS: Readonly<Record<ActorRole, readonly Permission[]>> = Object.freeze({
  viewer: Object.freeze(["read"]),
  requester: Object.freeze(["read", "request", "preview"]),
  operator: Object.freeze(["read", "request", "preview", "approve", "execute"]),
  admin: Object.freeze(["read", "request", "preview", "approve", "execute", "install", "share", "revoke", "policy.manage"]),
});
export const permissionsForRole = (role: ActorRole): readonly Permission[] => ROLE_PERMISSIONS[role];
export type AuthorizationDecision = { readonly allowed: true } | { readonly allowed: false; readonly code: "actor_disabled" | "scope_denied" | "permission_denied" | "capability_unknown" | "capability_denied" };
export interface AuthorizationInput {
  readonly actor: ActorContext;
  readonly tenantId: string;
  readonly requiredPermissions: readonly Permission[];
  readonly requiredCapabilities: readonly string[];
  readonly allowedCapabilities?: readonly CapabilityId[];
  readonly resourceTenantIds?: readonly string[];
}
export function authorize(input: AuthorizationInput): AuthorizationDecision {
  if (!input.actor.enabled) return { allowed: false, code: "actor_disabled" };
  if (input.actor.tenantId !== input.tenantId || input.resourceTenantIds?.some((tenantId) => tenantId !== input.tenantId)) return { allowed: false, code: "scope_denied" };
  if (input.requiredCapabilities.some((capability) => !isCapabilityId(capability))) return { allowed: false, code: "capability_unknown" };
  const granted = permissionsForRole(input.actor.role);
  const capabilityPermissions = input.requiredCapabilities.map((capability) => CAPABILITY_MANIFEST[capability as CapabilityId].permission);
  if ([...input.requiredPermissions, ...capabilityPermissions].some((permission) => !granted.includes(permission))) return { allowed: false, code: "permission_denied" };
  if (input.allowedCapabilities && input.requiredCapabilities.some((capability) => !input.allowedCapabilities?.includes(capability as CapabilityId))) return { allowed: false, code: "capability_denied" };
  return { allowed: true };
}
export type ProofDecision = { readonly allowed: true } | { readonly allowed: false; readonly code: "proof_required" };
/** proofRequired is trusted server policy; recipes and browser payloads cannot set it. */
export function evaluateProofPolicy(input: { readonly proofRequired: boolean; readonly evidenceStatus: EvidenceStatus }): ProofDecision {
  return input.proofRequired && input.evidenceStatus !== "passed" ? { allowed: false, code: "proof_required" } : { allowed: true };
}

export function evidenceStatusForProof(status: ProofResultStatus): EvidenceStatus {
  return ({ verified: "passed", failed: "failed", unavailable: "blocked", not_applicable: "not_applicable" } as const)[status];
}

export type ApprovalDecision = { readonly allowed: true } | { readonly allowed: false; readonly code: "scope_denied" | "actor_mismatch" | "permission_denied" | "plan_not_ready" | "stale_plan" | "plan_expired" };

export function authorizeApproval(input: { readonly actor: ActorContext; readonly plan: Plan; readonly request: ApprovalRequestInput; readonly now: Date }): ApprovalDecision {
  if (input.actor.tenantId !== input.plan.tenantId) return { allowed: false, code: "scope_denied" };
  if (input.actor.actorId !== input.plan.actorId) return { allowed: false, code: "actor_mismatch" };
  if (!input.actor.enabled || !permissionsForRole(input.actor.role).includes("approve")) return { allowed: false, code: "permission_denied" };
  if (input.plan.state !== "ready") return { allowed: false, code: "plan_not_ready" };
  if (input.request.planId !== input.plan.id || input.request.expectedPlanVersion !== input.plan.planVersion || input.request.planHash !== input.plan.planHash) return { allowed: false, code: "stale_plan" };
  if (!Number.isFinite(input.now.getTime()) || Date.parse(input.plan.expiresAt) <= input.now.getTime()) return { allowed: false, code: "plan_expired" };
  return { allowed: true };
}
