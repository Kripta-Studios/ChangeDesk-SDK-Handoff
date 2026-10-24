import { test } from "vitest";
import assert from "node:assert/strict";
import { BudgetedApiPlannerProvider, VERIFIED_API_CONFIGS } from "../../apps/service/src/planner/api-provider.ts";
import { CodexCliPlannerProvider, InstalledCodex0164IsolationProbe, codexExecArgv } from "../../apps/service/src/planner/codex-cli-provider.ts";
import type { PlannerInput } from "../../apps/service/src/planner/types.ts";
import type { ProcessRunner } from "../../apps/service/src/planner/process-runner.ts";

const input:PlannerInput={requestId:"req",tenantId:"atlas",actorId:"actor",locale:"en",message:"assign category",selectedProductIds:["p01"],approvedCapabilities:["medusa.products.list"],adapter:{id:"medusa-v2",capabilityContract:"1",version:"2.22.1"}};
const config={executable:"codex",model:"explicit-model",isolatedCwd:"C:/isolated",outputSchemaPath:"C:/schema.json",timeoutMs:30_000,maxOutputBytes:64_000,maxReportedInputTokens:120_000,environment:{PATH:"fixed"}};

test("Codex adapter fails closed before spawning when the probed CLI version changes",async()=>{
  let spawned=false; const runner:ProcessRunner={async run(){spawned=true;throw new Error("must not run");}};
  const provider=new CodexCliPlannerProvider(config,runner,new InstalledCodex0164IsolationProbe("0.165.0"));
  await assert.rejects(provider.generate(input),(error:any)=>error.code==="BLOCKED_TOOL_ISOLATION"); assert.equal(spawned,false);
});

test("Codex argv is fixed, read-only, ephemeral, ignores config/rules, and never bypasses sandbox",()=>{
  const argv=codexExecArgv(config); const joined=argv.join(" ");
  for(const token of ["--ignore-user-config","--ignore-rules","--ephemeral","--sandbox","read-only","--output-schema","project_doc_max_bytes=0"]) assert.ok(joined.includes(token));
  for(const toolFeature of ["shell_tool","code_mode_host","unified_exec","unified_exec_tty","view_image","sleep_tool"]) assert.deepEqual(argv.slice(argv.indexOf("--disable",argv.indexOf(toolFeature)-1),argv.indexOf(toolFeature)+1),["--disable",toolFeature]);
  assert.equal(joined.includes("dangerously-bypass"),false); assert.equal(joined.includes(input.message),false);
});

test("API provider refuses network use without an explicit positive spend budget",async()=>{
  let fetched=false; const provider=new BudgetedApiPlannerProvider({...VERIFIED_API_CONFIGS.openaiLuna,maxCalls:1,maxOutputTokens:1000,timeoutMs:1000,authorizedBudgetUsd:0},{async get(){return "secret";}},async()=>{fetched=true;throw new Error("no");});
  await assert.rejects(provider.generate(input),(error:any)=>error.code==="API_BUDGET_NOT_AUTHORIZED"); assert.equal(fetched,false);
});

test("verified future providers preserve their explicit requested model IDs",()=>{
  assert.equal(VERIFIED_API_CONFIGS.openaiLuna.model,"gpt-6-luna");
  assert.equal(VERIFIED_API_CONFIGS.deepseekFlash.model,"deepseek-flash");
  assert.equal(VERIFIED_API_CONFIGS.openCodeDeepseekFlash.model,"deepseek-v4.1-flash");
});
