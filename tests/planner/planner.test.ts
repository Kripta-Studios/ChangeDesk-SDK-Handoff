import { test } from "vitest";
import assert from "node:assert/strict";
import type { Recipe } from "../../packages/contracts/src/types.ts";
import { ValidatingPlanner } from "../../apps/service/src/planner/planner.ts";
import { DeterministicFakePlannerProvider } from "../../apps/service/src/planner/fake-provider.ts";
import type { PlannerInput, PlannerProvider, ProviderUsage } from "../../apps/service/src/planner/types.ts";

const recipe:Recipe={schemaVersion:"1.0",recipeKey:"catalog.category.assign.v1",displayName:"Assign",description:"Assign category",compatibility:{adapter:"medusa-v2",capabilityContract:"1",verifiedMedusaVersion:"2.22.1"},parameters:{categoryId:{kind:"resource",resource:"medusa.product_category"}},selection:{resource:"medusa.product",maxRecords:100,requireStatus:"published"},requiredCapabilities:["medusa.products.list","medusa.products.retrieve","medusa.product_categories.retrieve","medusa.product_categories.products.add"],steps:[{id:"addCategory",capability:"medusa.product_categories.products.add",forEach:"selectedProducts",dependsOn:[],arguments:{productId:{$record:"id"},categoryId:{$param:"categoryId"}}}],ui:{kind:"action",label:"Assign",fields:[{name:"categoryId",control:"resource-picker",label:"Category"}]}};
const input:PlannerInput={requestId:"req-1",tenantId:"atlas",actorId:"atlas.operator",locale:"en",message:"Assign category",selectedProductIds:["p01"],approvedCapabilities:recipe.requiredCapabilities,adapter:{id:"medusa-v2",capabilityContract:"1",version:"2.22.1"},structuredIntent:{recipeKey:recipe.recipeKey}};
const fakeUsage:ProviderUsage={provider:"fake",configuredModel:"bad",observedModel:"bad",calls:1,inputTokens:null,cachedInputTokens:null,outputTokens:null,reasoningOutputTokens:null,latencyMs:1,price:null,live:false};

test("deterministic fake is explicitly non-live and follows structured intent",async()=>{
  const fake=new DeterministicFakePlannerProvider({"catalog.category.assign.v1":recipe,"catalog.channel.assign.v1":{...recipe,recipeKey:"catalog.channel.assign.v1"} as Recipe,"catalog.campaign.prepare.v1":{...recipe,recipeKey:"catalog.campaign.prepare.v1"} as Recipe});
  const result=await fake.generate(input);
  assert.equal(result.proposal.kind,"candidate"); assert.equal(result.usage.live,false); assert.equal(result.usage.provider,"fake");
});

test("finite text-only intent distinguishes category, channel, and combined campaign",async()=>{
  const recipes={"catalog.category.assign.v1":recipe,"catalog.channel.assign.v1":{...recipe,recipeKey:"catalog.channel.assign.v1"} as Recipe,"catalog.campaign.prepare.v1":{...recipe,recipeKey:"catalog.campaign.prepare.v1"} as Recipe};const fake=new DeterministicFakePlannerProvider(recipes);
  const {structuredIntent:_structuredIntent,...textInput}=input;
  for(const [message,key] of [["Assign only a category","catalog.category.assign.v1"],["Añade solo el canal","catalog.channel.assign.v1"],["Prepare category and sales channel campaign","catalog.campaign.prepare.v1"]] as const){const result=await fake.generate({...textInput,message});assert.equal(result.proposal.kind,"candidate");if(result.proposal.kind==="candidate")assert.equal(result.proposal.recipe.recipeKey,key);}
});

test("planner retries invalid untrusted output at most three times",async()=>{
  let calls=0; const provider:PlannerProvider={id:"fake",async generate(){calls++;return {proposal:{kind:"candidate",recipe:{proofRequired:false,shell:"rm -rf"}},usage:fakeUsage};}};
  const planner=new ValidatingPlanner(provider,()=>({ok:false,code:"SCHEMA_INVALID"}),{maxCalls:3,maxMessageCharacters:4000});
  const result=await planner.plan(input);
  assert.equal(result.kind,"unsupported"); assert.equal(calls,3); assert.equal(result.usage.length,3);
});

test("planner rejects oversized and duplicate selection before provider",async()=>{
  let calls=0; const provider:PlannerProvider={id:"fake",async generate(){calls++;return {proposal:{kind:"candidate",recipe},usage:fakeUsage};}};
  const planner=new ValidatingPlanner(provider,()=>({ok:true,recipe}));
  const result=await planner.plan({...input,selectedProductIds:["p01","p01"]});
  assert.equal(result.kind,"unsupported"); assert.equal(calls,0);
});
