import type {
  ActorContext,
  Candidate,
  CapabilityId,
  Recipe,
  RecipeKey,
} from "@changedesk/contracts";

export interface AdapterDescriptor {
  readonly id: "medusa-v2";
  readonly capabilityContract: "1";
  readonly version: string;
}

export interface StructuredIntent {
  readonly recipeKey?: RecipeKey;
  readonly operation?: "campaign" | "assign_category" | "assign_channel";
}

export interface PlannerInput {
  readonly requestId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly locale: "es" | "en";
  readonly message: string;
  readonly selectedProductIds: readonly string[];
  readonly approvedCapabilities: readonly CapabilityId[];
  readonly adapter: AdapterDescriptor;
  readonly structuredIntent?: StructuredIntent;
}

export interface ProviderUsage {
  readonly provider: "fake" | "codex-cli" | "openai" | "deepseek" | "opencode";
  readonly configuredModel: string;
  readonly observedModel: string | null;
  readonly calls: number;
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningOutputTokens: number | null;
  readonly latencyMs: number;
  readonly price: { readonly value: number; readonly currency: string; readonly tariffDate: string } | null;
  readonly live: boolean;
}

export type PlannerResult =
  | { readonly kind: "candidate"; readonly recipe: Recipe; readonly usage: readonly ProviderUsage[] }
  | { readonly kind: "needs_clarification"; readonly safeMessage: string; readonly usage: readonly ProviderUsage[] }
  | { readonly kind: "unsupported"; readonly safeMessage: string; readonly usage: readonly ProviderUsage[] }
  | { readonly kind: "provider_unavailable"; readonly safeMessage: string; readonly retryable: boolean; readonly code: string; readonly usage: readonly ProviderUsage[] };

export interface PlannerPort {
  plan(input: PlannerInput, signal?: AbortSignal): Promise<PlannerResult>;
}

export type ProviderProposal =
  | { readonly kind: "candidate"; readonly recipe: unknown }
  | { readonly kind: "needs_clarification"; readonly safeMessage: string }
  | { readonly kind: "unsupported"; readonly safeMessage: string };

export interface PlannerProvider {
  readonly id: ProviderUsage["provider"];
  generate(input: PlannerInput, signal?: AbortSignal): Promise<{ readonly proposal: ProviderProposal; readonly usage: ProviderUsage }>;
}

export type RecipeValidator = (value: unknown, approvedCapabilities: readonly CapabilityId[], adapter: AdapterDescriptor) =>
  | { readonly ok: true; readonly recipe: Recipe }
  | { readonly ok: false; readonly code: string };

export interface CatalogSearchQuery {
  readonly actor: ActorContext;
  readonly recipeKey?: RecipeKey;
  readonly adapter: AdapterDescriptor;
  readonly approvedCapabilities: readonly CapabilityId[];
  readonly limit?: number;
}

export interface PublishInput {
  readonly actor: ActorContext;
  readonly sourceArtifactHash: string;
  readonly visibility: "provider_catalog" | "shared_allowlist";
  readonly allowedTenantIds: readonly string[];
  readonly consent: true;
  readonly keyId: string;
  readonly idempotencyKey: string;
}

export interface InstallInput {
  readonly actor: ActorContext;
  readonly artifactHash: string;
  readonly bindings: Readonly<Record<string, string>>;
  readonly policyVersion: string;
  readonly idempotencyKey: string;
  readonly adapter: AdapterDescriptor;
  readonly approvedCapabilities: readonly CapabilityId[];
  readonly allowedResourceIds: Readonly<{ categoryId: readonly string[]; channelId: readonly string[] }>;
}

export interface PublicationMutationInput {
  readonly actor: ActorContext;
  readonly publicationId: string;
  readonly reason?: string;
  readonly idempotencyKey: string;
}

export interface PublicationResult {
  readonly publicationId: string;
  readonly artifactHash: string;
  readonly version: string;
  readonly state: "published" | "withdrawn" | "security_revoked";
}

export interface InstallationResult {
  readonly installationId: string;
  readonly artifactHash: string;
  readonly version: string;
  readonly state: "active";
}

export interface InstallationOffer {
  readonly artifactHash: string;
  readonly displayName: string;
  readonly version: string;
  readonly recipeKey: RecipeKey;
  readonly requiredParameters: Candidate["missingParameters"];
  readonly evidenceStatus: Candidate["evidenceStatus"];
}

export interface CatalogPort {
  searchAuthorized(query: CatalogSearchQuery): Promise<readonly Candidate[]>;
  discoverInstallOffers(query: CatalogSearchQuery): Promise<readonly InstallationOffer[]>;
  getAuthorized(actor: ActorContext, publicationId: string): Promise<Candidate | null>;
  publishAuthorized(input: PublishInput): Promise<PublicationResult>;
  installAuthorized(input: InstallInput): Promise<InstallationResult>;
  withdrawAuthorized(input: PublicationMutationInput): Promise<PublicationResult>;
  securityRevokeAuthorized(input: PublicationMutationInput): Promise<PublicationResult>;
}

export class PlannerProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly usage: ProviderUsage[] = [],
  ) {
    super(message);
  }
}

export class CatalogAuthorizationError extends Error {
  readonly code = "CATALOG_NOT_FOUND_OR_FORBIDDEN";
  constructor() { super("Catalog resource was not found or is not available"); }
}

export class CatalogValidationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
