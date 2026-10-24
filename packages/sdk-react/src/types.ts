import type {
  Candidate,
  CreatePlanResponse,
  CreateRequestResponse,
  EvidenceSummary,
  ExecutionDetail,
  Installation,
  InstallationListResponse,
  Permission,
  Plan,
  PlanView as ContractPlanView,
  RequestDetail,
  RequestState,
} from "@changedesk/contracts";

export type ChangeDeskConfig = {
  endpoint: string;
  getSession: () => Promise<{ accessToken: string; expiresAt: string }>;
  locale: "es" | "en";
  getContext: () => { selectedProductIds: string[]; surface: string };
  onEvent?: (event: SafeUiEvent) => void;
};

export type SafeUiEvent =
  | { type: "panel_opened" }
  | { type: "candidate_offered"; candidateId: string }
  | { type: "candidate_selected"; candidateId: string }
  | { type: "plan_ready"; planId: string }
  | { type: "execution_updated"; executionId: string; status: string }
  | { type: "action_installed"; installationId: string }
  | { type: "error"; code: string; requestId?: string };

export type ProviderMode = "fake" | "live" | "unavailable";
export type WithPermissions<T> = T & { readonly permissions: readonly Permission[] };
export type IdentityView = { readonly tenantName: string; readonly actorName: string; readonly role: string };
export type RequestView = RequestDetail & { readonly providerMode?: ProviderMode; readonly permissions?: readonly Permission[]; readonly identity?: IdentityView };
export type CandidateView = Candidate;
export type PlanRowView = { readonly recordId: string; readonly productLabel: string; readonly observedStatus: string; readonly before: readonly string[]; readonly additions: readonly string[]; readonly outcome: "apply" | "no_op" | "excluded" | "blocked"; readonly reason?: string };
export type PlanView = ContractPlanView & { readonly rows?: readonly PlanRowView[]; readonly summary?: { readonly selected: number; readonly eligible: number; readonly additions: number; readonly noOp: number; readonly excluded: number; readonly blocked: number } };
export type ExecutionView = WithPermissions<ExecutionDetail>;
export type InstallationList = InstallationListResponse & { readonly identity?: IdentityView };
export type ResourceOption = { readonly id: string; readonly label: string; readonly kind: "category" | "channel" };
export type ResourceList = { readonly resources: readonly ResourceOption[] };
export type EvidenceView = WithPermissions<{ readonly evidence: EvidenceSummary }>;
export type RequestCreated = CreateRequestResponse;
export type PlanCreated = CreatePlanResponse;
export type ExecutionCreated = { readonly executionId: string; readonly status: string };

export type { Candidate, EvidenceSummary, ExecutionDetail, Installation, Permission, Plan, RequestDetail, RequestState };
