import type { ExecutionState, InstallationState, JsonValue, PlanState, RequestState } from "@changedesk/contracts";

export type TenantContext = Readonly<{ tenantId: string; actorId: string }>;
export type JobKind = "generation" | "execution" | "reconcile";
export type JobFinishStatus = "pending" | "completed" | "failed" | "cancelled";

export interface JobLease {
  readonly jobId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly backendKey: string;
  readonly kind: JobKind;
  readonly requestId: string | null;
  readonly executionId: string | null;
  readonly leaseOwner: string;
  readonly fence: number;
  readonly leaseUntil: Date;
  readonly attemptCount: number;
}

export interface RequestRecord {
  readonly id: string;
  readonly actorId: string;
  readonly state: RequestState;
  readonly createdAt: Date;
}

export interface RequestMessageRecord { readonly id:string;readonly requestId:string;readonly actorId:string;readonly clientRequestId:string;readonly redactedText:string;readonly createdAt:Date }

export interface PlanRecord {
  readonly id: string;
  readonly actorId: string;
  readonly planVersion: number;
  readonly planHash: string;
  readonly state: PlanState;
  readonly expiresAt: Date;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly planHash: string;
  readonly actorId: string;
  readonly expiresAt: Date;
  readonly consumedExecutionId: string | null;
}

export interface ExecutionRecord {
  readonly id: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly approvalId: string;
  readonly actorId: string;
  readonly priorExecutionId: string | null;
  readonly state: ExecutionState;
  readonly revision: number;
}

export interface NewRequest {
  readonly id: string;
  readonly actorId: string;
  readonly redactedText: string;
  readonly contextRef: JsonValue;
  readonly budget: JsonValue;
  readonly jobId: string;
  readonly backendKey?: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface NewPlan {
  readonly id: string;
  readonly requestId: string;
  readonly installationId?: string;
  readonly actorId: string;
  readonly artifactHash: string;
  readonly adapterVersion: string;
  readonly policyVersion: string;
  readonly capabilityManifestHash: string;
  readonly body: JsonValue;
  readonly planHash: string;
  readonly planVersion: number;
  readonly state: "draft" | "validating" | "ready" | "rejected" | "expired" | "superseded";
  readonly expiresAt: Date;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface NewApproval {
  readonly id: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly planHash: string;
  readonly actorId: string;
  readonly scope: readonly string[];
  readonly expiresAt: Date;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface ExecutionAdmission {
  readonly id: string;
  readonly approvalId: string;
  readonly actorId: string;
  readonly priorExecutionId?: string;
  readonly deadlineAt?: Date;
  readonly jobId: string;
  readonly backendKey?: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface AttemptIntent {
  readonly executionId: string;
  readonly rowId: string;
  readonly stepId: string;
  readonly attemptNo: number;
  readonly semanticInputHash: string;
  readonly operationKey: string;
}

export interface NewExecutionRow { readonly rowId:string;readonly resourceRef:string;readonly preconditionFingerprint:string }

export interface ExecutionBundle {
  readonly execution: Record<string, unknown>;
  readonly plan: Record<string, unknown>;
  readonly approval: Record<string, unknown>;
  readonly installation: Record<string, unknown> | null;
  readonly artifact: Record<string, unknown> | null;
  readonly actor: Record<string, unknown>;
  readonly rows: readonly Record<string, unknown>[];
  readonly attempts: readonly Record<string, unknown>[];
}

export interface CatalogQuery {
  readonly recipeKey?: string;
  readonly adapter: string;
  readonly capabilityContract: string;
  readonly limit: number;
}

export interface CatalogArtifact {
  readonly id: string;
  readonly ownerTenantId: string | null;
  readonly artifactHash: string;
  readonly schemaVersion: string;
  readonly canonicalBody: JsonValue;
  readonly state: string;
  readonly publicationId: string | null;
  readonly publisherTenantId: string | null;
  readonly signingKeyId: string | null;
  readonly signature: Uint8Array | null;
}

export interface PublicationRecord {
  readonly id: string;
  readonly publisherTenantId: string;
  readonly publisherActorId: string;
  readonly artifactId: string;
  readonly artifactHash: string;
  readonly signingKeyId: string;
  readonly signature: Uint8Array;
  readonly visibility: "private" | "provider_catalog" | "shared_allowlist";
  readonly state: string;
  readonly reviewedMetadata: JsonValue;
}

export interface InstallationRecord {
  readonly id: string;
  readonly artifactId: string;
  readonly artifactHash: string;
  readonly status: InstallationState;
  readonly policyVersion: string;
}

export interface PublicationKey {
  readonly id: string;
  readonly algorithm: "Ed25519";
  readonly publicKey: Uint8Array;
  readonly status: string;
}

export interface SessionRecord {
  readonly id: string;
  readonly actorId: string;
  readonly ticketId: string;
  readonly policyVersion: string;
  readonly expiresAt: Date;
}
