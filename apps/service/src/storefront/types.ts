export type StorefrontTheme = "light" | "dark" | "system";
export type StorefrontDensity = "comfortable" | "compact";
export type StorefrontProductLayout = "grid" | "list";

export interface StorefrontOverrides {
  readonly theme?: StorefrontTheme;
  readonly density?: StorefrontDensity;
  readonly productLayout?: StorefrontProductLayout;
}

export interface StorefrontPreferences {
  readonly overrides: StorefrontOverrides;
  readonly inherited: Required<StorefrontOverrides>;
  readonly effective: Required<StorefrontOverrides>;
  readonly buyerRevision: number;
  readonly globalRevision: number;
}

export interface BuyerContext {
  readonly kind: "buyer";
  readonly tenantId: string;
  readonly buyerId: string;
  readonly hostSessionId: string;
  readonly policyVersion: string;
  readonly expiresAt: string;
}

export interface StorefrontAdminContext {
  readonly kind: "staff";
  readonly tenantId: string;
  readonly actorId: string;
  readonly role: "viewer" | "requester" | "operator" | "admin";
  readonly policyVersion: string;
  readonly expiresAt: string;
}

export interface StorefrontProposal {
  readonly id: string;
  readonly tenantId: string;
  readonly buyerId: string;
  readonly baseGlobalRevision: number;
  readonly proposed: Required<StorefrontOverrides>;
  readonly status: "pending" | "approved" | "rejected";
  readonly proposalRevision: number;
  readonly createdAt: string;
  readonly decidedAt?: string;
}

export interface StorefrontAdminPreview {
  readonly proposalId: string;
  readonly proposalRevision: number;
  readonly current: Required<StorefrontOverrides>;
  readonly proposed: Required<StorefrontOverrides>;
  readonly globalRevision: number;
  readonly precedenceNotice: string;
  readonly status: StorefrontProposal["status"];
}

export type RepositoryResult<T> =
  | { readonly ok: true; readonly value: T; readonly replayed?: boolean }
  | { readonly ok: false; readonly code: "not_found" | "conflict" | "quota"; readonly reason: string };

export interface StorefrontRepository {
  getPreferences(context: BuyerContext): Promise<StorefrontPreferences>;
  replacePreferences(input: {
    context: BuyerContext;
    expectedRevision: number;
    overrides: StorefrontOverrides;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<RepositoryResult<StorefrontPreferences>>;
  createProposal(input: {
    context: BuyerContext;
    baseGlobalRevision: number;
    proposed: Required<StorefrontOverrides>;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<RepositoryResult<StorefrontProposal>>;
  getBuyerProposal(context: BuyerContext, proposalId: string): Promise<RepositoryResult<StorefrontProposal>>;
  listAdminProposals(context: StorefrontAdminContext): Promise<readonly StorefrontAdminPreview[]>;
  getAdminProposal(context: StorefrontAdminContext, proposalId: string): Promise<RepositoryResult<StorefrontAdminPreview>>;
  approveProposal(input: {
    context: StorefrontAdminContext;
    proposalId: string;
    expectedProposalRevision: number;
    expectedGlobalRevision: number;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<RepositoryResult<StorefrontAdminPreview>>;
  rejectProposal(input: {
    context: StorefrontAdminContext;
    proposalId: string;
    expectedProposalRevision: number;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<RepositoryResult<StorefrontAdminPreview>>;
}
