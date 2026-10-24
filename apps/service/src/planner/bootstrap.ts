import { createPrivateKey, randomUUID, type KeyLike } from "node:crypto";
import type { CapabilityId } from "@changedesk/contracts";
import type { Store } from "../storage/index.js";
import { artifactHash, canonicalizeJson, hashCanonical } from "../core/hashing.js";
import { createContractValidator } from "../core/validation.js";
import { permissionsForRole } from "../policy/index.js";
import { BudgetedApiPlannerProvider, createApiCallAuthorization, type ApiCallAuthorizationController, type ApiProviderConfig, type SecretResolver } from "./api-provider.js";
import { AuthorizedCatalog } from "./catalog.js";
import { CodexCliPlannerProvider, InstalledCodex0164IsolationProbe, type CodexCliProviderConfig } from "./codex-cli-provider.js";
import { DeterministicFakePlannerProvider } from "./fake-provider.js";
import { PostgresGenerationUsageLedger } from "./generation-budget.js";
import { PlannerGenerationProcessor, type GenerationStore } from "./generation-worker.js";
import { PostgresCatalogRepository } from "./postgres-catalog.js";
import { FixedArgvProcessRunner } from "./process-runner.js";
import { NodeEd25519Signer, canonicalGenericRecipe } from "./publication.js";
import { ValidatingPlanner } from "./planner.js";
import type { CatalogPort, PlannerProvider, RecipeValidator } from "./types.js";

export type BootstrapCodexConfig=Omit<CodexCliProviderConfig,"maxReportedInputTokens">&{readonly kind?:"codex-cli";readonly maxInputTokens:number};
export type BootstrapPlannerConfig =
  | BootstrapCodexConfig
  | {readonly kind:"api";readonly config:ApiProviderConfig;readonly secrets:SecretResolver}
  | {readonly kind:"fake-test";readonly allowExplicitTestFake:true};
export interface ProductionGenerationOptions {
  readonly store:Store;readonly catalog:CatalogPort;readonly planner:BootstrapPlannerConfig;readonly workerLeaseSeconds:number;
  readonly maxAttempts?:1|2|3;readonly totalTokenBudget?:bigint;readonly costBudgetMicros?:bigint;readonly newId?:()=>string;
}

export function createProductionGenerationProcessor(options:ProductionGenerationOptions):PlannerGenerationProcessor {
  const resolved=providerFor(options.planner),provider=resolved.provider,adapter={id:"medusa-v2" as const,capabilityContract:"1" as const,version:"2.22.1" as const};
  const contract=createContractValidator({verifiedMedusaVersion:adapter.version});
  const validateRecipe:RecipeValidator=(value,approved,current)=>{if(JSON.stringify(current)!==JSON.stringify(adapter))return{ok:false,code:"ADAPTER_PROFILE_MISMATCH"};const parsed=contract.validateRecipe(value);if(!parsed.ok)return{ok:false,code:"RECIPE_INVALID"};const allowed=new Set<CapabilityId>(approved);return parsed.value.requiredCapabilities.every((capability)=>allowed.has(capability))?{ok:true,recipe:parsed.value}:{ok:false,code:"CAPABILITY_NOT_APPROVED"};};
  const planner=new ValidatingPlanner(provider,validateRecipe,{maxCalls:1,maxMessageCharacters:4_000} as const),newId=options.newId??randomUUID;
  const costBudgetMicros=options.costBudgetMicros??0n;
  if(options.planner.kind==="api"&&costBudgetMicros<=0n)throw new Error("API planner requires an explicit positive durable cost budget");
  return new PlannerGenerationProcessor({store:options.store as unknown as GenerationStore,planner,catalog:options.catalog,identity:{hash:async(recipe)=>artifactHash(recipe),requestHash:async(value)=>hashCanonical("planner-request","1",value as object)},adapter,usageLedger:new PostgresGenerationUsageLedger(options.store),budget:{provider:provider.id,model:modelFor(options.planner),maxAttempts:options.maxAttempts??3,tokenBudget:options.totalTokenBudget??409_152n,costBudgetMicros,leaseSeconds:options.workerLeaseSeconds,intentHash:async(input)=>hashCanonical("planner-intent","1",{locale:input.locale,message:input.message,selectionCount:input.selectedProductIds.length,structuredIntent:input.structuredIntent??null,approvedCapabilities:[...input.approvedCapabilities].sort(),adapter:input.adapter})},...(resolved.authorization?{apiCallAuthorization:resolved.authorization}:{}),newId:()=>newId()});
}

export function createProductionCatalog(store:Store,input:{publicationKeyId:string;publicationPrivateKey:KeyLike;newId?:()=>string}):AuthorizedCatalog {
  const newId=input.newId??randomUUID;
  return new AuthorizedCatalog({repository:new PostgresCatalogRepository(store,()=>newId()),identity:{hash:async(recipe)=>artifactHash(recipe),requestHash:async(value)=>hashCanonical("catalog-request","1",value as object)},encoder:{encode:(value)=>Buffer.from(canonicalizeJson(value),"utf8")},signer:new NodeEd25519Signer(new Map([[input.publicationKeyId,input.publicationPrivateKey]])),permissionsFor:(actor)=>permissionsForRole(actor.role),newId:()=>newId()});
}
export function publicationPrivateKeyFromPem(pem:string){return createPrivateKey(pem);}

function providerFor(config:BootstrapPlannerConfig):{provider:PlannerProvider;authorization?:ApiCallAuthorizationController} {
  if(config.kind==="api"){if(!config.secrets)throw new Error("API planner requires an external secret resolver");const authorization=createApiCallAuthorization();return{provider:new BudgetedApiPlannerProvider(config.config,config.secrets,authorization.gate),authorization:authorization.controller};}
  if(config.kind==="fake-test"){if(!config.allowExplicitTestFake)throw new Error("Fake planner must be explicitly enabled for tests");const recipes={"catalog.campaign.prepare.v1":canonicalGenericRecipe("catalog.campaign.prepare.v1"),"catalog.category.assign.v1":canonicalGenericRecipe("catalog.category.assign.v1"),"catalog.channel.assign.v1":canonicalGenericRecipe("catalog.channel.assign.v1")};return{provider:new DeterministicFakePlannerProvider(recipes)};}
  const{maxInputTokens,kind:_kind,...codex}=config;return{provider:new CodexCliPlannerProvider({...codex,maxReportedInputTokens:maxInputTokens},new FixedArgvProcessRunner(),new InstalledCodex0164IsolationProbe("0.164.0",config.executableSha256))};
}
function modelFor(config:BootstrapPlannerConfig){return config.kind==="api"?config.config.model:config.kind==="fake-test"?"deterministic-fixture-v1":config.model;}
