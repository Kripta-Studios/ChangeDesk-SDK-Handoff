import type { EffectDelegationClaims } from "./types.ts"

export const buildAuthorityCheckInput = (claims: EffectDelegationClaims) => ({
  tenantId: claims.tenantId,
  actorId: claims.actorId,
  hostSessionId: claims.hostSessionId,
  executionId: claims.executionId,
  jobId: claims.jobId,
  leaseOwner: claims.leaseOwner,
  rowId: claims.rowId,
  stepId: claims.stepId,
  operationKey: claims.operationKey,
  fence: claims.fence,
  policyVersion: claims.policyVersion,
  planId: claims.planId,
  planVersion: claims.planVersion,
  planHash: claims.planHash,
  approvalId: claims.approvalId,
  approvalExpiresAt: claims.approvalExpiresAt,
  capability: claims.capability,
  argsHash: claims.argsHash,
  semanticInputHash: claims.semanticInputHash,
})
