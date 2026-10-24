import { test } from "vitest";
import assert from "node:assert/strict";
import type { Candidate } from "@changedesk/contracts";
import { PlannerGenerationProcessor, type GenerationLease } from "../../apps/service/src/planner/generation-worker.ts";
import { canonicalGenericRecipe } from "../../apps/service/src/planner/publication.ts";

const lease:GenerationLease={jobId:"job-1",tenantId:"atlas",actorId:"atlas.requester",backendKey:"atlas",kind:"generation",requestId:"request-1",leaseOwner:"worker-1",fence:1,leaseUntil:new Date(Date.now()+60_000).toISOString(),attemptCount:1};
const capabilities=canonicalGenericRecipe("catalog.category.assign.v1").requiredCapabilities;
function bundle(role:"viewer"|"requester"="requester"){return{request:{id:"request-1",actorId:"atlas.requester",redactedText:"Assign selected products to a category",contextRef:{selectedProductIds:["product-1"],locale:"en"}},actor:{role,enabled:true},tenant:{policyVersion:"policy-1"},capabilityManifest:{adapterVersion:"2.22.1",body:{capabilities}}};}
function fixture(options:{reused?:readonly Candidate[];role?:"viewer"|"requester"}={}){
  let persisted:any=null,state:string|null=null,plannerCalls=0;
  const tx={async loadGenerationBundle(){return bundle(options.role);},async addRequestCandidates(_l:any,_r:any,c:any){persisted=c;return true;},async persistGeneratedCandidate(_l:any,input:any){persisted=input;return true;},async updateRequestWithLease(_l:any,_r:any,next:string){state=next;return true;}};
  const processor=new PlannerGenerationProcessor({store:{async withTenant(_scope,work){return work(tx);}},catalog:{async searchAuthorized(){return options.reused??[];}} as any,planner:{async plan(){plannerCalls++;return{kind:"candidate",recipe:{...canonicalGenericRecipe("catalog.category.assign.v1"),displayName:"PRIVATE LABEL",description:"PRIVATE TENANT TEXT"},usage:[]};}},identity:{async hash(recipe){assert.equal(JSON.stringify(recipe).includes("PRIVATE"),false);return"a".repeat(64);},async requestHash(){return"b".repeat(64);}},adapter:{id:"medusa-v2",capabilityContract:"1",version:"2.22.1"},newId(kind){return`${kind}-1`;}});
  return{processor,get persisted(){return persisted;},get state(){return state;},get plannerCalls(){return plannerCalls;}};
}

test("generation reuses an exact ACL-filtered catalog candidate before calling the provider",async()=>{
  const reused:Candidate={id:"publication-1",artifactHash:"c".repeat(64),recipeKey:"catalog.category.assign.v1",displayName:"Assign category",version:"1",requiredCapabilities:capabilities,missingParameters:["categoryId"],compatibility:"compatible",evidenceStatus:"passed",estimatedCost:null};
  const f=fixture({reused:[reused]});assert.deepEqual(await f.processor.process(lease),{kind:"completed"});assert.equal(f.plannerCalls,0);assert.equal(f.persisted[0].artifactHash,reused.artifactHash);assert.equal(f.state,"candidate_offered");
});

test("generation validates then canonicalizes model metadata before private artifact persistence",async()=>{
  const f=fixture();assert.deepEqual(await f.processor.process(lease),{kind:"completed"});assert.equal(f.plannerCalls,1);assert.equal(f.persisted.artifact.canonicalBody.displayName,"Assign category");assert.ok(f.persisted.candidate.requiredCapabilities.includes("medusa.product_categories.products.add"));assert.equal(f.persisted.candidate.artifactHash,"a".repeat(64));assert.equal(f.state,"candidate_offered");
});

test("generation never invokes catalog or provider for a viewer",async()=>{
  const f=fixture({role:"viewer"});assert.deepEqual(await f.processor.process(lease),{kind:"completed"});assert.equal(f.plannerCalls,0);assert.equal(f.persisted,null);assert.equal(f.state,"rejected");
});
