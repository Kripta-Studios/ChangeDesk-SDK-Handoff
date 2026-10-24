export const STOREFRONT_THEMES = ["light", "dark", "system"] as const;
export const STOREFRONT_DENSITIES = ["comfortable", "compact"] as const;
export const STOREFRONT_PRODUCT_LAYOUTS = ["grid", "list"] as const;

export type StorefrontTheme = (typeof STOREFRONT_THEMES)[number];
export type StorefrontDensity = (typeof STOREFRONT_DENSITIES)[number];
export type StorefrontProductLayout = (typeof STOREFRONT_PRODUCT_LAYOUTS)[number];

export interface StorefrontOverrides {
  readonly theme?: StorefrontTheme;
  readonly density?: StorefrontDensity;
  readonly productLayout?: StorefrontProductLayout;
}

export interface StorefrontValues {
  readonly theme: StorefrontTheme;
  readonly density: StorefrontDensity;
  readonly productLayout: StorefrontProductLayout;
}

export interface BuyerContext {
  readonly kind: "buyer";
  readonly tenantId: string;
  readonly buyerId: string;
  readonly hostSessionId: string;
  readonly policyVersion: string;
  readonly expiresAt: string;
}

export interface StorefrontPreferencesResponse {
  readonly overrides: StorefrontOverrides;
  readonly effective: StorefrontValues;
  readonly buyerRevision: number;
  readonly globalRevision: number;
}

export interface ReplaceStorefrontPreferencesInput {
  readonly expectedRevision: number;
  readonly overrides: StorefrontOverrides;
}

export interface CreateStorefrontProposalInput {
  readonly baseGlobalRevision: number;
  readonly proposed: StorefrontValues;
}

export interface StorefrontProposalView {
  readonly id: string;
  readonly baseGlobalRevision: number;
  readonly proposed: StorefrontValues;
  readonly status: "pending" | "approved" | "rejected";
  readonly proposalRevision: number;
  readonly createdAt: string;
  readonly decidedAt?: string;
}

export interface StorefrontAdminProposalPreview {
  readonly proposalId: string;
  readonly proposalRevision: number;
  readonly current: StorefrontValues;
  readonly proposed: StorefrontValues;
  readonly globalRevision: number;
  readonly precedenceNotice: string;
  readonly status: StorefrontProposalView["status"];
}
