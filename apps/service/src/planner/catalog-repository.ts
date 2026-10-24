import type { ActorContext, Recipe, RecipeKey } from "@changedesk/contracts";
import type { AdapterDescriptor } from "./types.js";

export interface CatalogArtifactRecord {
  readonly id: string;
  readonly artifactHash: string;
  readonly recipe: Recipe;
  readonly state: string;
  readonly ownerTenantId: string | null;
  readonly publicationId: string | null;
  readonly publisherTenantId: string | null;
  readonly signingKeyId: string | null;
  readonly signature: Uint8Array | null;
  readonly publicationState?: string;
  readonly reviewedMetadata?: unknown;
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
  readonly reviewedMetadata: unknown;
}

export interface PublicationKeyRecord {
  readonly id: string;
  readonly algorithm: "Ed25519";
  readonly publicKey: Uint8Array;
  readonly status: string;
}

export interface NewPublicationRecord {
  readonly publicationId: string;
  readonly artifactId: string;
  readonly artifactHash: string;
  readonly recipe: Recipe;
  readonly keyId: string;
  readonly signature: Uint8Array;
  readonly visibility: "provider_catalog" | "shared_allowlist";
  readonly allowedTenantIds: readonly string[];
  readonly reviewedMetadata: unknown;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface CatalogRepository {
  /** Implementations MUST apply RLS/ACL before returning rows, counts, snippets, or hashes. */
  listVisible(actor: ActorContext, query: { recipeKey?: RecipeKey; adapter: AdapterDescriptor; limit: number }): Promise<readonly CatalogArtifactRecord[]>;
  getVisible(actor: ActorContext, publicationId: string): Promise<CatalogArtifactRecord | null>;
  getOwnedPrivateArtifact(actor: ActorContext, artifactHash: string): Promise<CatalogArtifactRecord | null>;
  publish(actor: ActorContext, input: NewPublicationRecord): Promise<PublicationRecord>;
  getVisiblePublicationForInstall(actor: ActorContext, publicationId: string): Promise<PublicationRecord | null>;
  getPublicationKey(actor: ActorContext, keyId: string): Promise<PublicationKeyRecord | null>;
  install(actor: ActorContext, input: { installationId: string; artifactId: string; artifactHash: string; bindings: Readonly<Record<string, string>>; policyVersion: string; idempotencyKey: string; requestHash: string }): Promise<{ id: string; artifactHash: string; status: string }>;
  changePublicationState(actor: ActorContext, publicationId: string, state: "withdrawn" | "security_revoked", idempotencyKey: string, requestHash: string): Promise<PublicationRecord | null>;
}

export interface ArtifactIdentity {
  hash(recipe: Recipe): Promise<string>;
  requestHash(value: unknown): Promise<string>;
}

export interface PublicationSigner {
  sign(keyId: string, canonicalEnvelope: Uint8Array): Promise<Uint8Array>;
}

export interface CanonicalEncoder {
  encode(value: unknown): Uint8Array;
}
