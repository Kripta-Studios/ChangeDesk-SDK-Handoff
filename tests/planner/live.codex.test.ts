import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "vitest";
import { CodexCliPlannerProvider, InstalledCodex0164IsolationProbe } from "../../apps/service/src/planner/codex-cli-provider.js";
import { FixedArgvProcessRunner } from "../../apps/service/src/planner/process-runner.js";

const live = process.env.CHANGEDESK_RUN_CODEX_LIVE === "1" ? test : test.skip;

live("local authenticated Codex produces a schema-wrapped proposal with no successful tool event", async () => {
  const isolatedCwd=resolve("scripts/planner-sandbox"); mkdirSync(isolatedCwd,{recursive:true});
  const model=process.env.CHANGEDESK_CODEX_MODEL;
  if(!model) throw new Error("CHANGEDESK_CODEX_MODEL must explicitly select the live Codex model");
  const environment:Record<string,string>={};
  for(const name of ["PATH","PATHEXT","SystemRoot","WINDIR","COMSPEC","TEMP","TMP","USERPROFILE","LOCALAPPDATA","APPDATA","CODEX_HOME"]) { const value=process.env[name]; if(value) environment[name]=value; }
  const provider=new CodexCliPlannerProvider({executable:resolve(process.env.LOCALAPPDATA??"","Programs/OpenAI/Codex/bin/codex.exe"),model,allowedModels:[model],isolatedCwd,
    outputSchemaPath:resolve("apps/service/src/planner/provider-output.schema.json"),timeoutMs:120_000,maxOutputBytes:64_000,maxReportedInputTokens:120_000,environment},new FixedArgvProcessRunner(),new InstalledCodex0164IsolationProbe("0.164.0"));
  const result=await provider.generate({requestId:"live-smoke-1",tenantId:"synthetic",actorId:"synthetic.operator",locale:"en",message:"Assign the selected published products only to an existing category. Do not change channels.",selectedProductIds:["logical-p01"],
    approvedCapabilities:["medusa.products.list","medusa.products.retrieve","medusa.product_categories.retrieve","medusa.product_categories.products.add"],adapter:{id:"medusa-v2",capabilityContract:"1",version:"2.22.1"},structuredIntent:{recipeKey:"catalog.category.assign.v1"}});
  console.info(JSON.stringify({event:"planner_live_usage",usage:result.usage}));
  expect(result.proposal.kind).toBe("candidate"); expect(result.usage.provider).toBe("codex-cli"); expect(result.usage.live).toBe(true); expect(result.usage.inputTokens).toBeGreaterThan(0);
},130_000);
