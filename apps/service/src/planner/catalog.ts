import type { ActorContext, Candidate, CapabilityId, Permission, Recipe } from "@changedesk/contracts";
import type { ArtifactIdentity, CanonicalEncoder, CatalogArtifactRecord, CatalogRepository, PublicationSigner } from "./catalog-repository.js";
import { publicationEnvelope, sanitizeRecipeForPublication, verifyPublicationSignature, type SignatureEnvelope } from "./publication.js";
import type { CatalogPort, CatalogSearchQuery, InstallationOffer, InstallInput, InstallationResult, PublicationMutationInput, PublicationResult, PublishInput } from "./types.js";
import { CatalogAuthorizationError, CatalogValidationError } from "./types.js";

export interface CatalogServiceOptions {
  readonly repository: CatalogRepository;
  readonly identity: ArtifactIdentity;
  readonly encoder: CanonicalEncoder;
  readonly signer: PublicationSigner;
  permissionsFor(actor: ActorContext): readonly Permission[];
  newId(kind: "artifact" | "publication" | "installation" | "grant"): string;
}

export class AuthorizedCatalog implements CatalogPort {
  constructor(private readonly options: CatalogServiceOptions) {}

  async searchAuthorized(query: CatalogSearchQuery): Promise<readonly Candidate[]> {
    assertEnabled(query.actor);
    const rows = await this.options.repository.listVisible(query.actor, {
      ...(query.recipeKey ? {recipeKey:query.recipeKey} : {}), adapter: query.adapter, limit: Math.min(Math.max(query.limit ?? 20, 1), 20),
    });
    return rows.filter((row) => compatible(row.recipe, query)).slice(0, 3).map(toCandidate);
  }

  async getAuthorized(actor: ActorContext, publicationId: string): Promise<Candidate | null> {
    assertEnabled(actor);
    const row = await this.options.repository.getVisible(actor, publicationId);
    return row ? toCandidate(row) : null;
  }

  async discoverInstallOffers(query:CatalogSearchQuery):Promise<readonly InstallationOffer[]> {
    assertEnabled(query.actor);
    const rows=await this.options.repository.listVisible(query.actor,{...(query.recipeKey?{recipeKey:query.recipeKey}:{}),adapter:query.adapter,limit:Math.min(Math.max(query.limit??20,1),20)}),offers:InstallationOffer[]=[];
    for(const row of rows){
      if(!row.publicationId||!compatible(row.recipe,query))continue;
      const publication=await this.options.repository.getVisiblePublicationForInstall(query.actor,row.publicationId);
      if(!publication||publication.state!=="published"||publication.artifactHash!==row.artifactHash)continue;
      const key=await this.options.repository.getPublicationKey(query.actor,publication.signingKeyId),envelope=extractEnvelope(publication.reviewedMetadata);
      if(!key||key.algorithm!=="Ed25519"||key.status!=="active"||!envelope||envelope.artifactHash!==row.artifactHash||
        (publication.publisherTenantId!==query.actor.tenantId&&!envelope.allowedTenantIds.includes(query.actor.tenantId))||
        !verifyPublicationSignature(key.publicKey,envelope,publication.signature,this.options.encoder))continue;
      let recipe:Recipe;try{recipe=sanitizeRecipeForPublication(row.recipe);}catch{continue;}
      if(await this.options.identity.hash(recipe)!==row.artifactHash)continue;
      offers.push({artifactHash:row.artifactHash,displayName:recipe.displayName,version:"1",recipeKey:recipe.recipeKey,requiredParameters:Object.keys(recipe.parameters) as InstallationOffer["requiredParameters"],evidenceStatus:"not_run"});
    }
    return offers.slice(0,3);
  }

  async publishAuthorized(input: PublishInput): Promise<PublicationResult> {
    requirePermissions(input.actor, this.options.permissionsFor(input.actor), ["share"]);
    const source = await this.options.repository.getOwnedPrivateArtifact(input.actor, input.sourceArtifactHash);
    if (!source) throw new CatalogAuthorizationError();
    const recipe = sanitizeRecipeForPublication(source.recipe);
    const artifactHash = await this.options.identity.hash(recipe);
    const visibility = input.visibility;
    const allowedTenantIds = uniqueSafeTenantIds(input.allowedTenantIds, input.actor.tenantId);
    const envelope = publicationEnvelope({ artifactHash, publisherTenantId: input.actor.tenantId, visibility, allowedTenantIds });
    const signature = await this.options.signer.sign(input.keyId, this.options.encoder.encode(envelope));
    const publicationId = this.options.newId("publication");
    const artifactId = artifactHash === source.artifactHash ? source.id : this.options.newId("artifact");
    const requestHash = await this.options.identity.requestHash({ ...input, actor: { tenantId: input.actor.tenantId, actorId: input.actor.actorId }, recipe, artifactHash });
    const created = await this.options.repository.publish(input.actor, {
      publicationId, artifactId, artifactHash, recipe, keyId: input.keyId,
      signature, visibility, allowedTenantIds,
      reviewedMetadata: { schemaVersion: "1", signatureEnvelope: envelope },
      idempotencyKey: input.idempotencyKey, requestHash,
    });
    return { publicationId: created.id, artifactHash: created.artifactHash, version: "1", state: "published" };
  }

  async installAuthorized(input: InstallInput): Promise<InstallationResult> {
    requirePermissions(input.actor, this.options.permissionsFor(input.actor), ["install"]);
    const artifact = await this.options.repository.getOwnedPrivateArtifact(input.actor,input.artifactHash) ??
      (await this.options.repository.listVisible(input.actor,{adapter:input.adapter,limit:20})).find((row)=>row.artifactHash===input.artifactHash);
    if (!artifact || !compatible(artifact.recipe,{actor:input.actor,adapter:input.adapter,approvedCapabilities:input.approvedCapabilities})) throw new CatalogAuthorizationError();
    sanitizeRecipeForPublication(artifact.recipe);
    if (artifact.ownerTenantId!==input.actor.tenantId) {
      if(!artifact.publicationId) throw new CatalogAuthorizationError();
      const publication=await this.options.repository.getVisiblePublicationForInstall(input.actor,artifact.publicationId);
      if (!publication || publication.state !== "published" || publication.artifactHash !== input.artifactHash) throw new CatalogAuthorizationError();
      const key = await this.options.repository.getPublicationKey(input.actor, publication.signingKeyId);
      const envelope = extractEnvelope(publication.reviewedMetadata);
      if (!key || key.algorithm !== "Ed25519" || key.status !== "active" || !envelope || envelope.artifactHash !== publication.artifactHash ||
          !verifyPublicationSignature(key.publicKey, envelope, publication.signature, this.options.encoder)) throw new CatalogValidationError("PUBLICATION_SIGNATURE_INVALID", "Publication signature or key is invalid");
    }
    validateBindings(artifact.recipe,input.bindings,input.allowedResourceIds);
    const installed = await this.options.repository.install(input.actor, {
      installationId: this.options.newId("installation"), artifactId: artifact.id,
      artifactHash: artifact.artifactHash, bindings: { ...input.bindings }, policyVersion: input.policyVersion,
      idempotencyKey: input.idempotencyKey,
      requestHash: await this.options.identity.requestHash({ artifactHash: artifact.artifactHash, bindings: input.bindings, policyVersion: input.policyVersion }),
    });
    return { installationId: installed.id, artifactHash: installed.artifactHash, version: "1", state: "active" };
  }

  withdrawAuthorized(input: PublicationMutationInput) { return this.changeState(input, "withdrawn"); }
  securityRevokeAuthorized(input: PublicationMutationInput) { return this.changeState(input, "security_revoked"); }

  private async changeState(input: PublicationMutationInput, state: "withdrawn" | "security_revoked"): Promise<PublicationResult> {
    requirePermissions(input.actor, this.options.permissionsFor(input.actor), ["revoke"]);
    if (state === "security_revoked" && (!input.reason || input.reason.length > 500)) {
      throw new CatalogValidationError("REVOCATION_REASON_REQUIRED", "A bounded security reason is required");
    }
    const changed = await this.options.repository.changePublicationState(input.actor, input.publicationId, state, input.idempotencyKey,
      await this.options.identity.requestHash({ publicationId: input.publicationId, state, reason: input.reason ?? null }));
    if (!changed) throw new CatalogAuthorizationError();
    return { publicationId: changed.id, artifactHash: changed.artifactHash, version: "1", state };
  }
}

function compatible(recipe: Recipe, query: CatalogSearchQuery): boolean {
  const allowed = new Set<CapabilityId>(query.approvedCapabilities);
  return recipe.compatibility.adapter === query.adapter.id && recipe.compatibility.verifiedMedusaVersion === query.adapter.version &&
    recipe.compatibility.capabilityContract === query.adapter.capabilityContract &&
    recipe.requiredCapabilities.every((capability) => allowed.has(capability));
}
function toCandidate(row: CatalogArtifactRecord): Candidate {
  return { id: row.publicationId ?? row.id, artifactHash: row.artifactHash, recipeKey: row.recipe.recipeKey,
    displayName: row.recipe.displayName, version: "1", requiredCapabilities: row.recipe.requiredCapabilities,
    missingParameters: Object.keys(row.recipe.parameters) as Candidate["missingParameters"], compatibility: "compatible",
    evidenceStatus: "not_run", estimatedCost: null };
}
function assertEnabled(actor: ActorContext) { if (!actor.enabled) throw new CatalogAuthorizationError(); }
function requirePermissions(actor: ActorContext, granted: readonly Permission[], needed: readonly Permission[]) {
  assertEnabled(actor); const actual = new Set(granted); if (!needed.every((item) => actual.has(item))) throw new CatalogAuthorizationError();
}
function uniqueSafeTenantIds(values: readonly string[], publisherTenantId: string): string[] {
  if (values.length < 1 || values.length > 100) throw new CatalogValidationError("PUBLICATION_AUDIENCE_INVALID", "A bounded allowlist is required");
  const result = [...new Set(values)];
  if (result.some((value) => value === publisherTenantId || !/^[a-z][a-z0-9_-]{0,63}$/.test(value))) throw new CatalogValidationError("PUBLICATION_AUDIENCE_INVALID", "Publication audience is invalid");
  return result.sort();
}
function validateBindings(recipe:Recipe,bindings: Readonly<Record<string, string>>, allowed:InstallInput["allowedResourceIds"]) {
  const keys = Object.keys(bindings);
  const expected=Object.keys(recipe.parameters).sort();
  if (JSON.stringify([...keys].sort())!==JSON.stringify(expected) || Object.values(bindings).some((value) => value.length < 1 || value.length > 120) ||
      (bindings.categoryId!==undefined&&!allowed.categoryId.includes(bindings.categoryId)) || (bindings.channelId!==undefined&&!allowed.channelId.includes(bindings.channelId))) {
    throw new CatalogValidationError("INSTALLATION_BINDINGS_INVALID", "Installation bindings are invalid");
  }
}
function extractEnvelope(value: unknown): SignatureEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const envelope = (value as { signatureEnvelope?: unknown }).signatureEnvelope;
  if (!envelope || typeof envelope !== "object") return null;
  const item = envelope as Partial<SignatureEnvelope>;
  return item.domain === "changedesk.publication.v1" && item.version === "1" && typeof item.artifactHash === "string" && typeof item.publisherTenantId === "string" &&
    (item.visibility === "shared_allowlist" || item.visibility === "provider_catalog") && Array.isArray(item.allowedTenantIds) ? item as SignatureEnvelope : null;
}
