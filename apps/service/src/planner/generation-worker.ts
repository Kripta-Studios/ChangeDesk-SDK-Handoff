import type { ActorContext, Candidate, CapabilityId, JsonValue, Recipe } from "@changedesk/contracts";
import { isCapabilityId } from "../core/capabilities.js";
import type { ArtifactIdentity } from "./catalog-repository.js";
import { inferRecipeKey } from "./fake-provider.js";
import { sanitizeRecipeForPublication } from "./publication.js";
import type { AdapterDescriptor, CatalogPort, PlannerInput, PlannerPort } from "./types.js";

export interface GenerationLease {
  readonly jobId: string; readonly tenantId: string; readonly actorId: string; readonly backendKey: string;
  readonly kind: "generation" | "execution" | "reconcile"; readonly requestId?: string;
  readonly leaseOwner: string; readonly fence: number; readonly leaseUntil: string; readonly attemptCount: number;
}
export type GenerationOutcome =
  | { readonly kind: "completed" }
  | { readonly kind: "waiting_reconciliation"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };
export interface GenerationProcessor { process(lease: GenerationLease): Promise<GenerationOutcome>; }

interface GenerationBundle {
  readonly request: { readonly id:string;readonly actorId:string;readonly redactedText:string;readonly contextRef:JsonValue };
  readonly actor: { readonly role:ActorContext["role"];readonly enabled:boolean };
  readonly tenant: { readonly policyVersion:string };
  readonly capabilityManifest: { readonly adapterVersion:string;readonly body:JsonValue };
}
interface PersistedCandidate {
  readonly id:string;readonly version:string;readonly artifactHash:string|null;readonly recipeKey:string;readonly displayName:string;
  readonly requiredCapabilities:readonly string[];readonly compatibility:"compatible";readonly evidenceStatus:Candidate["evidenceStatus"];
  readonly estimatedCost:{readonly value:number;readonly currency:string}|null;readonly safeMetadata:JsonValue;
}
interface GenerationTx {
  loadGenerationBundle(lease:GenerationLease):Promise<GenerationBundle|null>;
  addRequestCandidates(lease:GenerationLease,requestId:string,candidates:readonly PersistedCandidate[]):Promise<boolean>;
  persistGeneratedCandidate(lease:GenerationLease,input:{requestId:string;artifact:{id:string;artifactHash:string;schemaVersion:string;canonicalBody:Recipe};candidate:PersistedCandidate}):Promise<boolean>;
  updateRequestWithLease(lease:GenerationLease,requestId:string,state:"candidate_offered"|"needs_clarification"|"rejected"|"error"):Promise<boolean>;
}
export interface GenerationStore { withTenant<T>(scope:{tenantId:string;actorId:string},work:(tx:GenerationTx)=>Promise<T>):Promise<T>; }

export interface GenerationProcessorOptions {
  readonly store:GenerationStore;readonly planner:PlannerPort;readonly catalog:CatalogPort;readonly identity:ArtifactIdentity;
  readonly adapter:AdapterDescriptor;newId(kind:"artifact"|"candidate"):string;
}

export class PlannerGenerationProcessor implements GenerationProcessor {
  constructor(private readonly options:GenerationProcessorOptions) {}

  async process(lease:GenerationLease):Promise<GenerationOutcome> {
    if(lease.kind!=="generation"||!lease.requestId)return{kind:"failed",reason:"invalid_generation_lease"};
    const bundle=await this.scoped(lease,(tx)=>tx.loadGenerationBundle(lease));
    if(!bundle||bundle.request.id!==lease.requestId||bundle.request.actorId!==lease.actorId)return{kind:"failed",reason:"generation_bundle_unavailable"};
    if(!bundle.actor.enabled||bundle.actor.role==="viewer")return this.finishState(lease,bundle.request.id,"rejected","generation_actor_not_authorized");
    const input=parsePlannerInput(lease,bundle,this.options.adapter);
    if(!input)return this.finishState(lease,bundle.request.id,"error","generation_context_invalid");

    const recipeKey=inferRecipeKey(input);
    if(recipeKey){
      const reused=await this.options.catalog.searchAuthorized({actor:{tenantId:lease.tenantId,actorId:lease.actorId,...bundle.actor},recipeKey,adapter:this.options.adapter,approvedCapabilities:input.approvedCapabilities,limit:3});
      if(reused.length>0){
        const persisted=await this.scoped(lease,async(tx)=>await tx.addRequestCandidates(lease,bundle.request.id,reused.map((candidate)=>persistedCandidate(candidate,"catalog")))&&await tx.updateRequestWithLease(lease,bundle.request.id,"candidate_offered"));
        return persisted?{kind:"completed"}:{kind:"failed",reason:"generation_lease_lost"};
      }
    }

    const result=await this.options.planner.plan(input);
    if(result.kind==="provider_unavailable")return result.retryable?{kind:"waiting_reconciliation",reason:result.code}:this.finishState(lease,bundle.request.id,"error",result.code);
    if(result.kind==="needs_clarification")return this.finishState(lease,bundle.request.id,"needs_clarification","needs_clarification");
    if(result.kind==="unsupported")return this.finishState(lease,bundle.request.id,"rejected","unsupported_request");
    const recipe=sanitizeRecipeForPublication(result.recipe);
    const artifactHash=await this.options.identity.hash(recipe);
    const candidate:Candidate={id:this.options.newId("candidate"),artifactHash,recipeKey:recipe.recipeKey,displayName:recipe.displayName,version:"1",requiredCapabilities:recipe.requiredCapabilities,missingParameters:Object.keys(recipe.parameters) as Candidate["missingParameters"],compatibility:"compatible",evidenceStatus:"not_run",estimatedCost:latestUsd(result.usage)};
    const persisted=await this.scoped(lease,async(tx)=>await tx.persistGeneratedCandidate(lease,{requestId:bundle.request.id,artifact:{id:this.options.newId("artifact"),artifactHash,schemaVersion:recipe.schemaVersion,canonicalBody:recipe},candidate:persistedCandidate(candidate,"generated")})&&await tx.updateRequestWithLease(lease,bundle.request.id,"candidate_offered"));
    return persisted?{kind:"completed"}:{kind:"failed",reason:"generation_lease_lost"};
  }

  private scoped<T>(lease:GenerationLease,work:(tx:GenerationTx)=>Promise<T>){return this.options.store.withTenant({tenantId:lease.tenantId,actorId:lease.actorId},work);}
  private async finishState(lease:GenerationLease,requestId:string,state:"needs_clarification"|"rejected"|"error",reason:string):Promise<GenerationOutcome>{return await this.scoped(lease,(tx)=>tx.updateRequestWithLease(lease,requestId,state))?{kind:"completed"}:{kind:"failed",reason};}
}

function parsePlannerInput(lease:GenerationLease,bundle:GenerationBundle,adapter:AdapterDescriptor):PlannerInput|null {
  const context=bundle.request.contextRef,manifest=bundle.capabilityManifest.body;
  if(bundle.capabilityManifest.adapterVersion!==adapter.id||!record(context)||!record(manifest)||manifest.capabilityContract!==adapter.capabilityContract||manifest.verifiedMedusaVersion!==adapter.version)return null;
  const selected=context.selectedProductIds,locale=context.locale,capabilities=manifest.capabilities;
  if(!Array.isArray(selected)||selected.some((value)=>typeof value!=="string")||(locale!=="en"&&locale!=="es")||!Array.isArray(capabilities)||capabilities.some((value)=>typeof value!=="string"||!isCapabilityId(value)))return null;
  const structuredIntent=parseStructuredIntent(context.structuredIntent);
  if(context.structuredIntent!==undefined&&!structuredIntent)return null;
  return{requestId:bundle.request.id,tenantId:lease.tenantId,actorId:lease.actorId,locale,message:bundle.request.redactedText,selectedProductIds:selected as string[],approvedCapabilities:[...new Set(capabilities as CapabilityId[])],adapter,...(structuredIntent?{structuredIntent}:{})};
}
function persistedCandidate(candidate:Candidate,source:"catalog"|"generated"):PersistedCandidate{return{id:candidate.id,version:candidate.version,artifactHash:candidate.artifactHash,recipeKey:candidate.recipeKey,displayName:candidate.displayName,requiredCapabilities:candidate.requiredCapabilities,compatibility:"compatible",evidenceStatus:candidate.evidenceStatus,estimatedCost:candidate.estimatedCost,safeMetadata:{source}};}
function latestUsd(usage:Awaited<ReturnType<PlannerPort["plan"]>>["usage"]){for(let index=usage.length-1;index>=0;index--){const price=usage[index]?.price;if(price?.currency==="USD")return{value:price.value,currency:"USD"};}return null;}
function record(value:unknown):value is {[key:string]:JsonValue}{return !!value&&typeof value==="object"&&!Array.isArray(value);}
function parseStructuredIntent(value:unknown):PlannerInput["structuredIntent"]|undefined {
  if(value===undefined)return undefined;
  if(!record(value)||Object.keys(value).some((key)=>key!=="recipeKey"&&key!=="operation"))return undefined;
  const recipeKey=value.recipeKey,operation=value.operation;
  if(recipeKey!==undefined&&!(["catalog.campaign.prepare.v1","catalog.category.assign.v1","catalog.channel.assign.v1"] as const).includes(recipeKey as never))return undefined;
  if(operation!==undefined&&!(["campaign","assign_category","assign_channel"] as const).includes(operation as never))return undefined;
  if(recipeKey===undefined&&operation===undefined)return undefined;
  type Intent=NonNullable<PlannerInput["structuredIntent"]>;type Key=Exclude<Intent["recipeKey"],undefined>;type Operation=Exclude<Intent["operation"],undefined>;
  if(recipeKey!==undefined&&operation!==undefined)return{recipeKey:recipeKey as Key,operation:operation as Operation};
  if(recipeKey!==undefined)return{recipeKey:recipeKey as Key};
  return{operation:operation as Operation};
}
