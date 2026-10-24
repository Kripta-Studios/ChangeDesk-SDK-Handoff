import { test } from "vitest";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import type { ActorContext, Permission, Recipe } from "../../packages/contracts/src/types.ts";
import { AuthorizedCatalog } from "../../apps/service/src/planner/catalog.ts";
import type { CanonicalEncoder, CatalogArtifactRecord, CatalogRepository, NewPublicationRecord, PublicationKeyRecord, PublicationRecord } from "../../apps/service/src/planner/catalog-repository.ts";
import { sanitizeRecipeForPublication } from "../../apps/service/src/planner/publication.ts";

const privateCanary="ATLAS_SECRET_PRODUCT_123";
const recipe:Recipe={schemaVersion:"1.0",recipeKey:"catalog.category.assign.v1",displayName:privateCanary,description:`tenant ${privateCanary}`,compatibility:{adapter:"medusa-v2",capabilityContract:"1",verifiedMedusaVersion:"2.22.1"},parameters:{categoryId:{kind:"resource",resource:"medusa.product_category"}},selection:{resource:"medusa.product",maxRecords:100,requireStatus:"published"},requiredCapabilities:["medusa.products.list","medusa.products.retrieve","medusa.product_categories.retrieve","medusa.product_categories.products.add"],steps:[{id:"addCategory",capability:"medusa.product_categories.products.add",forEach:"selectedProducts",dependsOn:[],arguments:{productId:{$record:"id"},categoryId:{$param:"categoryId"}}}],ui:{kind:"action",label:privateCanary,fields:[{name:"categoryId",control:"resource-picker",label:privateCanary}]}};
const atlas:ActorContext={tenantId:"atlas",actorId:"atlas.admin",role:"admin",enabled:true};
const boreal:ActorContext={tenantId:"boreal",actorId:"boreal.admin",role:"admin",enabled:true};
const encoder:CanonicalEncoder={encode(value){return Buffer.from(JSON.stringify(value));}};

class MemoryRepository implements CatalogRepository {
  visible:CatalogArtifactRecord[]=[]; source:CatalogArtifactRecord={id:"src",artifactHash:"private-hash",recipe,state:"private",ownerTenantId:"atlas",publicationId:null,publisherTenantId:null,signingKeyId:null,signature:null}; publication?:PublicationRecord; key?:PublicationKeyRecord;
  async listVisible(actor:ActorContext,_query?:unknown){return this.visible.filter((row)=>row.ownerTenantId===actor.tenantId||row.publicationId);}
  async getVisible(actor:ActorContext,id:string){return (await this.listVisible(actor,{} as any)).find((x)=>x.publicationId===id)??null;}
  async getOwnedPrivateArtifact(actor:ActorContext,hash:string){return this.source.ownerTenantId===actor.tenantId&&this.source.artifactHash===hash?this.source:null;}
  async publish(actor:ActorContext,input:NewPublicationRecord){this.publication={id:input.publicationId,publisherTenantId:actor.tenantId,publisherActorId:actor.actorId,artifactId:input.artifactId,artifactHash:input.artifactHash,signingKeyId:input.keyId,signature:input.signature,visibility:input.visibility,state:"published",reviewedMetadata:input.reviewedMetadata};this.visible=[{id:input.artifactId,artifactHash:input.artifactHash,recipe:input.recipe,state:"published",ownerTenantId:actor.tenantId,publicationId:input.publicationId,publisherTenantId:actor.tenantId,signingKeyId:input.keyId,signature:input.signature,reviewedMetadata:input.reviewedMetadata}];return this.publication;}
  async getVisiblePublicationForInstall(){return this.publication??null;} async getPublicationKey(){return this.key??null;}
  async install(_a:ActorContext,input:any){return {id:input.installationId,artifactHash:input.artifactHash,status:"active"};}
  async changePublicationState(_a:ActorContext,_id:string,state:string){if(!this.publication)return null;this.publication={...this.publication,state};return this.publication;}
}

function fixture(){let id=0;const repo=new MemoryRepository();const {privateKey,publicKey}=generateKeyPairSync("ed25519");repo.key={id:"key-1",algorithm:"Ed25519",publicKey:publicKey.export({format:"der",type:"spki"}),status:"active"};const permissions=new Map<string,Permission[]>([[atlas.actorId,["share","revoke","install"]],[boreal.actorId,["install"]]]);const service=new AuthorizedCatalog({repository:repo,encoder,identity:{async hash(value){return `hash:${Buffer.from(JSON.stringify(value)).toString("base64url").slice(0,20)}`;},async requestHash(){return "request-hash";}},signer:{async sign(_keyId,bytes){return sign(null,bytes,privateKey);}},permissionsFor(a){return permissions.get(a.actorId)??[];},newId(kind){return `${kind}-${++id}`;}});return {repo,service};}

test("publication reconstructs from a positive allowlist and leaks no tenant text",async()=>{
  const safe=sanitizeRecipeForPublication(recipe); assert.equal(JSON.stringify(safe).includes(privateCanary),false);
  const {repo,service}=fixture();const result=await service.publishAuthorized({actor:atlas,sourceArtifactHash:"private-hash",visibility:"shared_allowlist",allowedTenantIds:["boreal"],consent:true,keyId:"key-1",idempotencyKey:"idem-1"});
  assert.equal(result.state,"published");assert.equal(JSON.stringify(repo.visible[0].recipe).includes(privateCanary),false);
});

test("publication rejects a recipe whose claimed key hides different capabilities",()=>{
  const poisoned={...recipe,requiredCapabilities:[...recipe.requiredCapabilities,"medusa.sales_channels.products.add"],steps:[...recipe.steps,{id:"hiddenChannel",capability:"medusa.sales_channels.products.add",forEach:"selectedProducts",dependsOn:[],arguments:{productId:{$record:"id"},channelId:{$param:"channelId"}}}]} as Recipe;
  assert.throws(()=>sanitizeRecipeForPublication(poisoned),(error:any)=>error.code==="PUBLICATION_SEMANTICS_MISMATCH");
});

test("publication source must be owned, not merely visible",async()=>{
  const {service}=fixture();await assert.rejects(service.publishAuthorized({actor:boreal,sourceArtifactHash:"private-hash",visibility:"provider_catalog",allowedTenantIds:["atlas"],consent:true,keyId:"key-1",idempotencyKey:"idem"}),(error:any)=>error.code==="CATALOG_NOT_FOUND_OR_FORBIDDEN");
});

test("installation verifies active Ed25519 key and keeps local bindings separate",async()=>{
  const {repo,service}=fixture();const published=await service.publishAuthorized({actor:atlas,sourceArtifactHash:"private-hash",visibility:"shared_allowlist",allowedTenantIds:["boreal"],consent:true,keyId:"key-1",idempotencyKey:"p"});
  const common={actor:boreal,artifactHash:published.artifactHash,adapter:{id:"medusa-v2" as const,capabilityContract:"1" as const,version:"2.22.1"},approvedCapabilities:recipe.requiredCapabilities,allowedResourceIds:{categoryId:["boreal-category","other"],channelId:[]},policyVersion:"policy-1"};
  const installed=await service.installAuthorized({...common,bindings:{categoryId:"boreal-category"},idempotencyKey:"i"});assert.equal(installed.state,"active");
  repo.key={...repo.key!,status:"revoked"};await assert.rejects(service.installAuthorized({...common,bindings:{categoryId:"other"},idempotencyKey:"i2"}),(error:any)=>error.code==="PUBLICATION_SIGNATURE_INVALID");
});

test("admin can install an owned validated generic private artifact without a publication",async()=>{
  const {service}=fixture();const installed=await service.installAuthorized({actor:atlas,artifactHash:"private-hash",bindings:{categoryId:"atlas-category"},policyVersion:"policy-1",idempotencyKey:"private-i",adapter:{id:"medusa-v2",capabilityContract:"1",version:"2.22.1"},approvedCapabilities:recipe.requiredCapabilities,allowedResourceIds:{categoryId:["atlas-category"],channelId:[]}});assert.equal(installed.artifactHash,"private-hash");
});

test("installation rejects wrong adapter version and resource outside host allowlist",async()=>{
  const {service}=fixture();const base={actor:atlas,artifactHash:"private-hash",bindings:{categoryId:"foreign"},policyVersion:"policy-1",idempotencyKey:"bad-i",adapter:{id:"medusa-v2" as const,capabilityContract:"1" as const,version:"2.22.0"},approvedCapabilities:recipe.requiredCapabilities,allowedResourceIds:{categoryId:["atlas-category"],channelId:[]}};
  await assert.rejects(service.installAuthorized(base),(error:any)=>error.code==="CATALOG_NOT_FOUND_OR_FORBIDDEN");
});

test("withdrawal and security revocation remain distinct",async()=>{
  const {service}=fixture();const published=await service.publishAuthorized({actor:atlas,sourceArtifactHash:"private-hash",visibility:"provider_catalog",allowedTenantIds:["boreal"],consent:true,keyId:"key-1",idempotencyKey:"p"});
  assert.equal((await service.withdrawAuthorized({actor:atlas,publicationId:published.publicationId,idempotencyKey:"w"})).state,"withdrawn");
  assert.equal((await service.securityRevokeAuthorized({actor:atlas,publicationId:published.publicationId,reason:"compromised",idempotencyKey:"r"})).state,"security_revoked");
});
