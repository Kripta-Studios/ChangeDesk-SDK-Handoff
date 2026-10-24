import type { EffectAuthority, ExecutionBundle, JobLease, PlanEffect } from "./types.js";

export class StrictEffectAuthority implements EffectAuthority {
  async authorizeEffectJustInTime(lease: JobLease, bundle: ExecutionBundle, _effect: PlanEffect, now: Date): Promise<{ allowed: true } | { allowed: false; code: string }> {
    if (Date.parse(lease.leaseUntil) <= now.getTime()) return { allowed: false, code: "lease_expired" };
    if (bundle.execution.cancelRequestedAt) return { allowed: false, code: "cancelled" };
    if (!bundle.authority.actorEnabled) return { allowed: false, code: "actor_revoked" };
    if (bundle.authority.policyVersion !== bundle.plan.policyVersion) return { allowed: false, code: "policy_changed" };
    if (bundle.authority.artifactState !== "active") return { allowed: false, code: "artifact_inactive" };
    if (Date.parse(bundle.approval.expiresAt) <= now.getTime()) return { allowed: false, code: "approval_expired" };
    if (bundle.approval.planHash !== bundle.plan.planHash || bundle.approval.actorId !== bundle.plan.actorId) return { allowed: false, code: "approval_stale" };
    return { allowed: true };
  }
}
