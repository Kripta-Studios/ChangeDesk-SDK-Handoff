import { test } from "vitest";
import assert from "node:assert/strict";
import { createProductionGenerationProcessor } from "../../apps/service/src/planner/bootstrap.ts";

test("production factory permits fake planning only through the explicit test variant",()=>{
  const base={store:{} as any,catalog:{} as any,workerLeaseSeconds:30};
  assert.throws(()=>createProductionGenerationProcessor({...base,planner:{kind:"fake-test",allowExplicitTestFake:false} as any}),/explicitly enabled/u);
  const processor=createProductionGenerationProcessor({...base,planner:{kind:"fake-test",allowExplicitTestFake:true},newId:()=>"synthetic-id"});
  assert.equal(typeof processor.process,"function");
});

test("production factory requires both an external API secret and a positive durable outer budget",()=>{
  const config={provider:"openai" as const,endpoint:"https://api.openai.com/v1/responses",model:"gpt-6-luna",apiKeyEnvironmentName:"OPENAI_API_KEY",maxCallsPerRequest:1,maxInputTokens:10_000,maxOutputTokens:1_000,maxResponseBytes:64_000,timeoutMs:30_000,authorizedBudgetUsd:0,protocol:"responses" as const};
  assert.throws(()=>createProductionGenerationProcessor({store:{} as any,catalog:{} as any,workerLeaseSeconds:30,planner:{kind:"api",config,secrets:undefined as any}}),/secret resolver/u);
  assert.throws(()=>createProductionGenerationProcessor({store:{} as any,catalog:{} as any,workerLeaseSeconds:30,planner:{kind:"api",config:{...config,authorizedBudgetUsd:1,maxPricePerCallUsd:0.01},secrets:{async get(){return "test-only";}}}}),/durable cost budget/u);
});
