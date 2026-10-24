import type { ActorContext, Recipe } from "@changedesk/contracts";
import type { CatalogArtifactRecord, CatalogRepository, NewPublicationRecord, PublicationKeyRecord, PublicationRecord } from "./catalog-repository.js";
import type { AdapterDescriptor } from "./types.js";

interface StorageArtifact {
  id: string; artifactHash: string; schemaVersion: string; canonicalBody: unknown; state: string; ownerTenantId: string | null;
  publicationId: string | null; publisherTenantId: string | null; signingKeyId: string | null; signature: Uint8Array | null;
}
interface StoragePublication {
  id:string; publisherTenantId:string; publisherActorId:string; artifactId:string; artifactHash:string; signingKeyId:string;
  signature:Uint8Array; visibility:"private"|"provider_catalog"|"shared_allowlist"; state:string; reviewedMetadata:unknown;
}
interface StorageTx {
  listDiscoverableCatalog(query:{recipeKey?:string;adapter:string;capabilityContract:string;limit:number}):Promise<StorageArtifact[]>;
  getAuthorizedArtifact(artifactHash:string):Promise<StorageArtifact|null>;
  insertArtifact(input:{id:string;artifactHash:string;schemaVersion:string;canonicalBody:unknown;idempotencyKey:string;requestHash:string}):Promise<StorageArtifact>;
  grantArtifact(input:{id:string;artifactId:string;recipientScope:"tenant";recipientTenantId:string;rights:readonly string[];idempotencyKey:string;requestHash:string}):Promise<void>;
  insertPublication(input:{id:string;artifactId:string;artifactHash:string;signingKeyId:string;signature:Uint8Array;visibility:"private"|"provider_catalog"|"shared_allowlist";state:"published";reviewedMetadata:unknown;idempotencyKey:string;requestHash:string}):Promise<StoragePublication>;
  getPublicationForUpdate(id:string):Promise<StoragePublication|null>;
  updatePublicationState(id:string,state:"withdrawn"|"security_revoked", control:{idempotencyKey:string;requestHash:string}):Promise<StoragePublication|null>;
  insertInstallation(input:{id:string;artifactId:string;artifactHash:string;config:unknown;policyVersion:string;idempotencyKey:string;requestHash:string}):Promise<{id:string;artifactHash:string;status:string}>;
  getPublicationKey(keyId:string):Promise<PublicationKeyRecord|null>;
}
export interface TenantCatalogStore {
  withTenant<T>(context:{tenantId:string;actorId:string},work:(tx:StorageTx)=>Promise<T>):Promise<T>;
}

export class PostgresCatalogRepository implements CatalogRepository {
  constructor(private readonly store: TenantCatalogStore, private readonly newId: (kind:"grant")=>string) {}

  listVisible(actor: ActorContext, query: { recipeKey?: Recipe["recipeKey"]; adapter: AdapterDescriptor; limit: number }): Promise<readonly CatalogArtifactRecord[]> {
    return this.store.withTenant(actor, async (tx) => (await tx.listDiscoverableCatalog({ ...(query.recipeKey?{recipeKey:query.recipeKey}:{}), adapter:query.adapter.id, capabilityContract:query.adapter.capabilityContract, limit:query.limit })).map((row)=>mapArtifact(row)));
  }
  getVisible(actor: ActorContext, publicationId: string): Promise<CatalogArtifactRecord|null> {
    return this.store.withTenant(actor, async (tx) => {
      const publication=await tx.getPublicationForUpdate(publicationId); if(!publication) return null;
      const artifact=await tx.getAuthorizedArtifact(publication.artifactHash); return artifact ? mapArtifact(artifact,publication) : null;
    });
  }
  getOwnedPrivateArtifact(actor: ActorContext, artifactHash: string): Promise<CatalogArtifactRecord|null> {
    return this.store.withTenant(actor, async (tx) => { const row=await tx.getAuthorizedArtifact(artifactHash); if(!row || row.ownerTenantId!==actor.tenantId || row.state!=="private") return null; return mapArtifact(row); });
  }
  publish(actor: ActorContext, input: NewPublicationRecord): Promise<PublicationRecord> {
    return this.store.withTenant(actor, async (tx) => {
      const existing=await tx.getAuthorizedArtifact(input.artifactHash);
      const artifact=existing?.ownerTenantId===actor.tenantId&&existing.id===input.artifactId?existing:
        await tx.insertArtifact({id:input.artifactId,artifactHash:input.artifactHash,schemaVersion:input.recipe.schemaVersion,canonicalBody:input.recipe,idempotencyKey:`${input.idempotencyKey}:artifact`,requestHash:input.requestHash});
      const publication=await tx.insertPublication({id:input.publicationId,artifactId:artifact.id,artifactHash:input.artifactHash,signingKeyId:input.keyId,signature:input.signature,visibility:input.visibility,state:"published",reviewedMetadata:input.reviewedMetadata,idempotencyKey:input.idempotencyKey,requestHash:input.requestHash});
      for(const tenantId of input.allowedTenantIds) await tx.grantArtifact({id:this.newId("grant"),artifactId:artifact.id,recipientScope:"tenant",recipientTenantId:tenantId,rights:["read","install"],idempotencyKey:`${input.idempotencyKey}:grant:${tenantId}`,requestHash:input.requestHash});
      return publication;
    });
  }
  getVisiblePublicationForInstall(actor: ActorContext, publicationId: string): Promise<PublicationRecord|null> {
    return this.store.withTenant(actor, (tx)=>tx.getPublicationForUpdate(publicationId));
  }
  getPublicationKey(actor: ActorContext, keyId: string): Promise<PublicationKeyRecord|null> { return this.store.withTenant(actor,(tx)=>tx.getPublicationKey(keyId)); }
  install(actor: ActorContext, input: {installationId:string;artifactId:string;artifactHash:string;bindings:Readonly<Record<string,string>>;policyVersion:string;idempotencyKey:string;requestHash:string}) {
    return this.store.withTenant(actor,(tx)=>tx.insertInstallation({id:input.installationId,artifactId:input.artifactId,artifactHash:input.artifactHash,config:{bindings:input.bindings},policyVersion:input.policyVersion,idempotencyKey:input.idempotencyKey,requestHash:input.requestHash}));
  }
  changePublicationState(actor: ActorContext, publicationId: string, state: "withdrawn"|"security_revoked", idempotencyKey:string, requestHash:string): Promise<PublicationRecord|null> {
    return this.store.withTenant(actor,(tx)=>tx.updatePublicationState(publicationId,state,{idempotencyKey,requestHash}));
  }
}

function mapArtifact(row:StorageArtifact, publication?:StoragePublication):CatalogArtifactRecord {
  return {id:row.id,artifactHash:row.artifactHash,recipe:row.canonicalBody as Recipe,state:row.state,ownerTenantId:row.ownerTenantId,
    publicationId:publication?.id??row.publicationId,publisherTenantId:publication?.publisherTenantId??row.publisherTenantId,
    signingKeyId:publication?.signingKeyId??row.signingKeyId,signature:publication?.signature??row.signature,
    ...(publication ? {publicationState:publication.state,reviewedMetadata:publication.reviewedMetadata} : {})};
}
