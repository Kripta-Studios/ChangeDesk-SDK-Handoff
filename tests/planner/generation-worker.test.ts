import { test } from "vitest";
import assert from "node:assert/strict";
import type { Candidate } from "@changedesk/contracts";
import { PlannerGenerationProcessor, type GenerationLease } from "../../apps/service/src/planner/generation-worker.ts";
import { canonicalGenericRecipe } from "../../apps/service/src/planner/publication.ts";

const lease:GenerationLease={jobId:"job-1",tenantId:"atlas",actorId:"atlas.requester",backendKey:"atlas",kind:"generation",requestId:"request-1",leaseOwner:"worker-1",fence:1,leaseUntil:new Date(Date.now()+60_000).toISOString(),attemptCount:1};
const capabilities=canonicalGenericRecipe("catalog.category.assign.v1").requiredCapabilities;
function bundle(role:"viewer"|"requester"="requester"){return{request:{id:"request-1",actorId:"atlas.requester",redactedText:"Assign selected products to a category",contextRef:{selectedProductIds:["product-1"],locale:"en"}},actor:{role,enabled:true},tenant:{policyVersion:"policy-1"},capabilityManifest:{adapterVersion:"medusa-v2",body:{capabilities,capabilityContract:"1",verifiedMedusaVersion:"2.22.1"}}};}
function fixture(options:{reused?:readonly Candidate[];role?:"viewer"|"requester";plannerResult?:any;withinBudget?:boolean}={}){
  let persisted:any=null,state:string|null=null,plannerCalls=0;const recorded:any[]=[];
  const tx={async loadGenerationBundle(){return bundle(options.role);},async addRequestCandidates(_l:any,_r:any,c:any){persisted=c;return true;},async persistGeneratedCandidate(_l:any,input:any){persisted=input;return true;},async updateRequestWithLease(_l:any,_r:any,next:string){state=next;return true;}};
  const processor=new PlannerGenerationProcessor({store:{async withTenant(_scope,work){return work(tx);}},catalog:{async searchAuthorized(){return options.reused??[];}} as any,planner:{maxCallsPerPlan:1,async plan(){plannerCalls++;return options.plannerResult??{kind:"candidate",recipe:{...canonicalGenericRecipe("catalog.category.assign.v1"),displayName:"PRIVATE LABEL",description:"PRIVATE TENANT TEXT"},usage:[]};}},identity:{async hash(recipe){assert.equal(JSON.stringify(recipe).includes("PRIVATE"),false);return"a".repeat(64);},async requestHash(){return"b".repeat(64);}},adapter:{id:"medusa-v2",capabilityContract:"1",version:"2.22.1"},usageLedger:{async reserveCall(){return{reservationId:"reservation-1",fence:1n,attempt:1};},async recordCall(_scope,_token,value){recorded.push(value);return{recorded:true,withinBudget:options.withinBudget??true};}},budget:{provider:"codex-cli",model:"gpt-6.1-sol",maxAttempts:3,tokenBudget:360_000n,costBudgetMicros:0n,leaseSeconds:120,async intentHash(){return"b".repeat(64);}},newId(kind){return`${kind}-1`;}});
  return{processor,recorded,get persisted(){return persisted;},get state(){return state;},get plannerCalls(){return plannerCalls;}};
}

test("generation reuses an exact ACL-filtered catalog candidate before calling the provider",async()=>{
  const reused:Candidate={id:"publication-1",artifactHash:"c".repeat(64),recipeKey:"catalog.category.assign.v1",displayName:"Assign category",version:"1",requiredCapabilities:capabilities,missingParameters:["categoryId"],compatibility:"compatible",evidenceStatus:"passed",estimatedCost:null};
  const f=fixture({reused:[reused]});assert.deepEqual(await f.processor.process(lease),{kind:"completed"});assert.equal(f.plannerCalls,0);assert.equal(f.persisted[0].artifactHash,reused.artifactHash);assert.equal(f.state,"candidate_offered");
});

test("generation validates then canonicalizes model metadata before private artifact persistence",async()=>{
  const f=fixture();assert.deepEqual(await f.processor.process(lease),{kind:"completed"});assert.equal(f.plannerCalls,1);assert.equal(f.persisted.artifact.canonicalBody.displayName,"Assign category");assert.ok(f.persisted.candidate.requiredCapabilities.includes("medusa.product_categories.products.add"));assert.equal(f.persisted.candidate.artifactHash,"a".repeat(64));assert.equal(f.persisted.generationToken.reservationId,"reservation-1");assert.equal(f.recorded[0].success,true);assert.equal(f.state,"candidate_offered");
});

test("generation never invokes catalog or provider for a viewer",async()=>{
  const f=fixture({role:"viewer"});assert.deepEqual(await f.processor.process(lease),{kind:"completed"});assert.equal(f.plannerCalls,0);assert.equal(f.persisted,null);assert.equal(f.state,"rejected");
});

test("generation durably records failed usage before a bounded retry",async()=>{
  const usage={provider:"codex-cli",configuredModel:"gpt-6.1-sol",observedModel:null,calls:1,inputTokens:13,cachedInputTokens:0,outputTokens:2,reasoningOutputTokens:0,latencyMs:5,price:null,live:true};
  const f=fixture({plannerResult:{kind:"provider_unavailable",safeMessage:"Unavailable",retryable:true,code:"PROVIDER_TIMEOUT",usage:[usage]}});assert.deepEqual(await f.processor.process(lease),{kind:"waiting_reconciliation",reason:"PROVIDER_TIMEOUT"});assert.deepEqual(f.recorded[0],{inputTokens:13n,outputTokens:2n,usedCostMicros:0n,retryable:true,success:false});
});

test("generation blocks persistence after recording a token or cost budget overrun",async()=>{
  const f=fixture({withinBudget:false});assert.deepEqual(await f.processor.process(lease),{kind:"failed",reason:"generation_budget_exceeded"});assert.equal(f.persisted,null);assert.equal(f.recorded.length,1);
});
