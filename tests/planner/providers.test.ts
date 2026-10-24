import { test } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { BudgetedApiPlannerProvider, VERIFIED_API_CONFIGS } from "../../apps/service/src/planner/api-provider.ts";
import { CodexCliPlannerProvider, InstalledCodex0164IsolationProbe, codexExecArgv } from "../../apps/service/src/planner/codex-cli-provider.ts";
import type { PlannerInput } from "../../apps/service/src/planner/types.ts";
import type { ProcessRunner } from "../../apps/service/src/planner/process-runner.ts";
import { canonicalGenericRecipe } from "../../apps/service/src/planner/publication.ts";

const input:PlannerInput={requestId:"req",tenantId:"atlas",actorId:"actor",locale:"en",message:"assign category",selectedProductIds:["p01"],approvedCapabilities:["medusa.products.list"],adapter:{id:"medusa-v2",capabilityContract:"1",version:"2.22.1"}};
const executableSha256=createHash("sha256").update(readFileSync(process.execPath)).digest("hex");
const config={executable:process.execPath,executableSha256,model:"explicit-model",allowedModels:["explicit-model"],isolatedCwd:"C:/isolated",outputSchemaPath:"C:/schema.json",timeoutMs:30_000,maxOutputBytes:64_000,maxReportedInputTokens:120_000,environment:{PATH:"fixed"}};

test("Codex structured output contract accepts each reviewed canonical recipe instance", () => {
  const schema = JSON.parse(readFileSync("apps/service/src/planner/provider-output.schema.json", "utf8"));
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  for (const recipeKey of ["catalog.category.assign.v1", "catalog.channel.assign.v1", "catalog.campaign.prepare.v1"] as const) {
    assert.equal(validate({ kind: "candidate", recipe: canonicalGenericRecipe(recipeKey), safeMessage: null }), true, JSON.stringify(validate.errors));
  }
});

test("Codex adapter fails closed before spawning when the probed CLI version changes",async()=>{
  let spawned=false; const runner:ProcessRunner={async run(){spawned=true;throw new Error("must not run");}};
  const provider=new CodexCliPlannerProvider(config,runner,new InstalledCodex0164IsolationProbe("0.165.0",executableSha256));
  await assert.rejects(provider.generate(input),(error:any)=>error.code==="BLOCKED_TOOL_ISOLATION"); assert.equal(spawned,false);
});

test("Codex argv is fixed, read-only, ephemeral, ignores config/rules, and never bypasses sandbox",()=>{
  const argv=codexExecArgv(config); const joined=argv.join(" ");
  for(const token of ["--ignore-user-config","--ignore-rules","--ephemeral","--sandbox","read-only","--output-schema","project_doc_max_bytes=0"]) assert.ok(joined.includes(token));
  for(const toolFeature of ["shell_tool","code_mode_host","unified_exec","unified_exec_tty","view_image","sleep_tool"]) assert.deepEqual(argv.slice(argv.indexOf("--disable",argv.indexOf(toolFeature)-1),argv.indexOf(toolFeature)+1),["--disable",toolFeature]);
  assert.equal(joined.includes("dangerously-bypass"),false); assert.equal(joined.includes(input.message),false);
});

test("verified Codex execution rejects every tool event instead of consuming it",async()=>{
  const runner:ProcessRunner={async run(){return {exitCode:0,stderr:"",timedOut:false,overflowed:false,stdout:[JSON.stringify({type:"thread.started"}),JSON.stringify({type:"turn.started"}),JSON.stringify({type:"item.completed",item:{type:"command_execution",command:"whoami"}}),JSON.stringify({type:"turn.completed",usage:{input_tokens:1,output_tokens:1}})].join("\n")};}};
  const provider=new CodexCliPlannerProvider(config,runner,{async inspect(){return {status:"verified",code:"EFFECTIVE_AUTHORITY_NONE",cliVersion:"test",executableSha256,digest:"test",effectiveAuthority:"none",observedToolDefinitions:1,projectInstructionsAbsent:true};}});
  await assert.rejects(provider.generate(input),(error:any)=>error.code==="PROVIDER_TOOL_EVENT");
});

test("API provider refuses network use without an explicit positive spend budget",async()=>{
  let fetched=false; const provider=new BudgetedApiPlannerProvider({...VERIFIED_API_CONFIGS.openaiLuna,maxCallsPerRequest:1,maxInputTokens:2000,maxOutputTokens:1000,maxResponseBytes:64000,timeoutMs:1000,authorizedBudgetUsd:0},{async get(){return "secret";}},{async reserve(){return true;}},async()=>{fetched=true;throw new Error("no");});
  await assert.rejects(provider.generate(input),(error:any)=>error.code==="API_BUDGET_NOT_AUTHORIZED"); assert.equal(fetched,false);
});

test("verified future providers preserve their explicit requested model IDs",()=>{
  assert.equal(VERIFIED_API_CONFIGS.openaiLuna.model,"gpt-6-luna");
  assert.equal(VERIFIED_API_CONFIGS.deepseekFlash.model,"deepseek-flash");
  assert.equal(VERIFIED_API_CONFIGS.openCodeDeepseekFlash.model,"deepseek-v4.1-flash");
});

test("API provider reserves a known budget per request, forbids redirects, and reports measured usage",async()=>{
  let calls=0;const fetchMock:typeof fetch=async(url,init)=>{calls++;assert.equal(url,VERIFIED_API_CONFIGS.openaiLuna.endpoint);assert.equal(init?.redirect,"error");return new Response(JSON.stringify({model:"gpt-6-luna",output_text:JSON.stringify({kind:"needs_clarification",recipe:null,safeMessage:"Choose a category."}),usage:{input_tokens:100,output_tokens:20}}),{status:200,headers:{"content-type":"application/json"}});};
  let reservations=0;const provider=new BudgetedApiPlannerProvider({...VERIFIED_API_CONFIGS.openaiLuna,maxCallsPerRequest:1,maxInputTokens:20000,maxOutputTokens:1000,maxResponseBytes:64000,timeoutMs:1000,authorizedBudgetUsd:0.01,tariff:{inputPerMillionUsd:0.1,outputPerMillionUsd:0.5,date:"2026-10-24"}},{async get(){return "synthetic-test-key";}},{async reserve(){return ++reservations===1;}},fetchMock);
  const result=await provider.generate(input);assert.equal(result.proposal.kind,"needs_clarification");assert.equal(result.usage.price?.value,0.00002);assert.equal(calls,1);
  await assert.rejects(provider.generate(input),(error:any)=>error.code==="PROVIDER_CALL_BUDGET_EXHAUSTED");assert.equal(calls,1);
});
