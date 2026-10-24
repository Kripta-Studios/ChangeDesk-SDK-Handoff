export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type ArtifactHash = string;
export type PlanHash = string;
export type IdempotencyKey = string;
export type ClientRequestId = string;

export const RECIPE_KEYS = Object.freeze([
  "catalog.campaign.prepare.v1",
  "catalog.category.assign.v1",
  "catalog.channel.assign.v1",
] as const);
export type RecipeKey = (typeof RECIPE_KEYS)[number];

export const CAPABILITY_IDS = Object.freeze([
  "medusa.products.list",
  "medusa.products.retrieve",
  "medusa.product_categories.retrieve",
  "medusa.sales_channels.retrieve",
  "medusa.product_categories.products.add",
  "medusa.sales_channels.products.add",
] as const);
export type CapabilityId = (typeof CAPABILITY_IDS)[number];
export type MutationCapabilityId = Extract<CapabilityId, `${string}.products.add`>;

export type ParameterName = "categoryId" | "channelId";
export type RecipeParameter =
  | { readonly kind: "resource"; readonly resource: "medusa.product_category" }
  | { readonly kind: "resource"; readonly resource: "medusa.sales_channel" };
export type RecipeReference =
  | { readonly $record: "id" }
  | { readonly $param: ParameterName };

export interface RecipeStep {
  readonly id: string;
  readonly capability: MutationCapabilityId;
  readonly forEach: "selectedProducts";
  readonly dependsOn: readonly string[];
  readonly arguments: Readonly<Record<string, RecipeReference>>;
}

export interface RecipeUiField {
  readonly name: ParameterName;
  readonly control: "resource-picker";
  readonly label: string;
}

export interface Recipe {
  readonly schemaVersion: "1.0";
  readonly recipeKey: RecipeKey;
  readonly displayName: string;
  readonly description: string;
  readonly compatibility: {
    readonly adapter: "medusa-v2";
    readonly capabilityContract: "1";
    readonly verifiedMedusaVersion: string;
  };
  readonly parameters: Readonly<Partial<Record<ParameterName, RecipeParameter>>>;
  readonly selection: {
    readonly resource: "medusa.product";
    readonly maxRecords: number;
    readonly requireStatus: "published";
  };
  readonly requiredCapabilities: readonly CapabilityId[];
  readonly steps: readonly RecipeStep[];
  readonly ui: {
    readonly kind: "action";
    readonly label: string;
    readonly fields: readonly RecipeUiField[];
  };
}

export interface RequestInput {
  readonly message: string;
  readonly selectedProductIds: readonly string[];
  readonly locale?: "es" | "en";
  readonly clientRequestId: ClientRequestId;
}

export interface ApprovalRequestInput {
  readonly planId: string;
  readonly planHash: PlanHash;
  readonly expectedPlanVersion: number;
  /** Must equal the Idempotency-Key request header; mismatch is a 400 before effects. */
  readonly idempotencyKey: IdempotencyKey;
}

export const PLAN_STATES = Object.freeze([
  "draft",
  "validating",
  "ready",
  "rejected",
  "expired",
  "superseded",
] as const);
export type PlanState = (typeof PLAN_STATES)[number];

export const EXECUTION_STATES = Object.freeze([
  "queued",
  "running",
  "waiting_reconciliation",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
] as const);
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const STEP_STATES = Object.freeze([
  "pending",
  "running",
  "succeeded",
  "skipped",
  "unknown",
  "failed",
] as const);
export type StepState = (typeof STEP_STATES)[number];

export const ROW_STATES = Object.freeze(["pending", "running", "succeeded", "skipped", "failed", "unknown", "needs_review"] as const);
export type RowState = (typeof ROW_STATES)[number];

export const EVIDENCE_STATUSES = Object.freeze([
  "passed",
  "failed",
  "blocked",
  "not_run",
  "not_applicable",
] as const);
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const PROOF_RESULT_STATUSES = Object.freeze(["verified", "failed", "unavailable", "not_applicable"] as const);
export type ProofResultStatus = (typeof PROOF_RESULT_STATUSES)[number];

export interface PlanSelectionRecord {
  readonly productId: string;
  readonly preconditionFingerprint: string;
}

export interface PlannedEffect {
  readonly recordId: string;
  readonly stepId: string;
  readonly capability: MutationCapabilityId;
  readonly arguments: Readonly<Record<string, string>>;
  readonly expected: "apply" | "no_op";
  readonly preconditionFingerprint: string;
}

export interface PlanExclusion {
  readonly recordId: string;
  readonly reason: "status" | "policy";
}

export interface PlanLimits {
  readonly maxRecords: number;
  readonly maxSteps: number;
  readonly deadlineAt?: string;
}

/** The exact immutable payload covered by `planHash`; presentation timestamps are excluded. */
export interface PlanHashInput {
  readonly schemaVersion: string;
  readonly id: string;
  readonly planVersion: number;
  readonly tenantId: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly artifactHash: ArtifactHash;
  readonly adapterVersion: string;
  readonly policyVersion: string;
  readonly capabilityManifestHash: string;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly selectionSnapshot: readonly PlanSelectionRecord[];
  readonly perRecordEffects: readonly PlannedEffect[];
  readonly exclusions: readonly PlanExclusion[];
  readonly limits: PlanLimits;
  readonly expiresAt: string;
  readonly evidenceRefs: readonly string[];
  readonly priorExecutionId?: string;
}

/** Public plan shape from docs/10; every normative field retains its exact API name. */
export interface Plan extends PlanHashInput {
  readonly createdAt: string;
  readonly planHash: PlanHash;
  readonly state: PlanState;
}

/** Presentation data stays outside PlanHashInput and can evolve without changing approval bytes. */
export interface PlanView {
  readonly plan: Plan;
  readonly title: string;
  readonly canApprove: boolean;
  readonly permissions: readonly Permission[];
}

export interface Approval {
  readonly id: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly planHash: PlanHash;
  readonly actorId: string;
  readonly scope: readonly Permission[];
  readonly expiresAt: string;
  readonly consumedExecutionId?: string;
}

export interface Execution {
  readonly id: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly approvalId: string;
  readonly actorId: string;
  readonly priorExecutionId?: string;
  readonly state: ExecutionState;
  readonly revision: number;
}

export const REQUEST_STATES = Object.freeze([
  "received", "searching", "candidate_offered", "generating", "needs_configuration", "needs_clarification", "plan_ready", "rejected", "error",
] as const);
export type RequestState = (typeof REQUEST_STATES)[number];

export interface Candidate {
  readonly id: string;
  readonly artifactHash: ArtifactHash;
  readonly recipeKey: RecipeKey;
  readonly displayName: string;
  readonly version: string;
  readonly requiredCapabilities: readonly CapabilityId[];
  readonly missingParameters: readonly ParameterName[];
  readonly compatibility: "compatible" | "adaptation_required" | "incompatible";
  readonly evidenceStatus: EvidenceStatus;
  readonly estimatedCost: { readonly value: number; readonly currency: string } | null;
}

export interface RequestDetail {
  readonly requestId: string;
  readonly status: RequestState;
  readonly safeMessage: string;
  readonly candidates: readonly Candidate[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExecutionStepDetail {
  readonly stepId: string;
  readonly capability: MutationCapabilityId;
  readonly state: StepState;
  readonly reasonCode?: string;
}

export interface ExecutionRowDetail {
  readonly rowId: string;
  readonly resourceRef: string;
  readonly state: RowState;
  readonly steps: readonly ExecutionStepDetail[];
}

export interface ExecutionDetail extends Execution {
  readonly rows: readonly ExecutionRowDetail[];
  readonly cancelRequestedAt?: string;
  readonly deadlineAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const INSTALLATION_STATES = Object.freeze(["active", "disabled", "security_revoked"] as const);
export type InstallationState = (typeof INSTALLATION_STATES)[number];

export interface Installation {
  readonly id: string;
  readonly artifactHash: ArtifactHash;
  readonly recipeKey: RecipeKey;
  readonly displayName: string;
  readonly version: string;
  readonly state: InstallationState;
  readonly policyVersion: string;
  readonly evidenceStatus: EvidenceStatus;
  readonly permissions: readonly Permission[];
  readonly installedAt: string;
  readonly lastValidatedAt?: string;
  readonly updateAvailable?: boolean;
}

export interface EvidenceSummary {
  readonly id: string;
  readonly status: EvidenceStatus;
  readonly scope: string;
  readonly artifactHash: ArtifactHash;
  readonly verifierVersion: string;
  readonly createdAt: string;
}

export interface ApiErrorDetail {
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, JsonValue>>;
}

export interface ApiErrorResponse {
  readonly error: ApiErrorDetail;
}

export interface CreateRequestResponse {
  readonly requestId: string;
  readonly status: RequestState;
}

export type SelectCandidateResponse = CreateRequestResponse;

export interface CreatePlanResponse {
  readonly planId: string;
  readonly status: PlanState;
}

export interface CreateApprovalResponse {
  readonly approvalId: string;
}

export interface StartExecutionResponse {
  readonly executionId: string;
  readonly status: ExecutionState;
}

export interface InstallationListResponse {
  readonly installations: readonly Installation[];
  readonly permissions: readonly Permission[];
}

export const ACTOR_ROLES = Object.freeze(["viewer", "requester", "operator", "admin"] as const);
export type ActorRole = (typeof ACTOR_ROLES)[number];

export const PERMISSIONS = Object.freeze([
  "read",
  "request",
  "preview",
  "approve",
  "execute",
  "install",
  "share",
  "revoke",
  "policy.manage",
] as const);
export type Permission = (typeof PERMISSIONS)[number];

export interface ActorContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly role: ActorRole;
  readonly enabled: boolean;
}

export interface AuthenticatedSession extends ActorContext {
  readonly sessionId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly policyVersion: string;
}

export interface ValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };
