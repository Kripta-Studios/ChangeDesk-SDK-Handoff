import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { test, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { recipeSchema } from "@changedesk/contracts/schemas";
import { CodexCliPlannerProvider, InstalledCodex0164IsolationProbe } from "../../apps/service/src/planner/codex-cli-provider.js";
import { FixedArgvProcessRunner } from "../../apps/service/src/planner/process-runner.js";

test("local authenticated Codex produces a validated finite proposal with no successful tool event", async () => {
  if(process.env.CHANGEDESK_RUN_CODEX_LIVE!=="1"){expect(()=>{throw new Error("BLOCKED_LIVE_SETTINGS: set CHANGEDESK_RUN_CODEX_LIVE=1 and explicit CHANGEDESK_CODEX_MODEL");}).toThrow(/BLOCKED_LIVE_SETTINGS/u);return;}
  const isolatedCwd=resolve("scripts/planner-sandbox"); mkdirSync(isolatedCwd,{recursive:true});
  const model=process.env.CHANGEDESK_CODEX_MODEL;
  if(!model) throw new Error("CHANGEDESK_CODEX_MODEL must explicitly select the live Codex model");
  const environment:Record<string,string>={};
  for(const name of ["PATH","PATHEXT","SystemRoot","WINDIR","COMSPEC","TEMP","TMP","USERPROFILE","LOCALAPPDATA","APPDATA","CODEX_HOME"]) { const value=process.env[name]; if(value) environment[name]=value; }
  const executable=resolve(process.env.LOCALAPPDATA??"","Programs/OpenAI/Codex/bin/codex.exe"),executableSha256=createHash("sha256").update(readFileSync(executable)).digest("hex");
  const provider=new CodexCliPlannerProvider({executable,executableSha256,model,allowedModels:[model],isolatedCwd,
    outputSchemaPath:resolve("apps/service/src/planner/provider-output.schema.json"),timeoutMs:120_000,maxOutputBytes:64_000,maxReportedInputTokens:120_000,environment},new FixedArgvProcessRunner(),new InstalledCodex0164IsolationProbe("0.164.0",executableSha256));
  const result=await provider.generate({requestId:"live-smoke-1",tenantId:"synthetic",actorId:"synthetic.operator",locale:"en",message:"Assign the selected published products only to an existing category. Do not change channels.",selectedProductIds:["logical-p01"],
    approvedCapabilities:["medusa.products.list","medusa.products.retrieve","medusa.product_categories.retrieve","medusa.product_categories.products.add"],adapter:{id:"medusa-v2",capabilityContract:"1",version:"2.22.1"},structuredIntent:{recipeKey:"catalog.category.assign.v1"}});
  console.info(JSON.stringify({event:"planner_live_usage",usage:result.usage}));
  expect(result.proposal.kind).toBe("candidate");
  if(result.proposal.kind!=="candidate")throw new Error("Expected candidate");
  const validate=new Ajv2020({strict:true,allErrors:true}).compile(recipeSchema);expect(validate(result.proposal.recipe),JSON.stringify(validate.errors)).toBe(true);
  expect(result.proposal.recipe.recipeKey).toBe("catalog.category.assign.v1");
  expect(result.proposal.recipe.requiredCapabilities.every((capability)=>["medusa.products.list","medusa.products.retrieve","medusa.product_categories.retrieve","medusa.product_categories.products.add"].includes(capability))).toBe(true);
  expect(result.proposal.recipe.steps.every((step)=>step.capability==="medusa.product_categories.products.add")).toBe(true);
  expect(result.usage.provider).toBe("codex-cli"); expect(result.usage.live).toBe(true); expect(result.usage.inputTokens).toBeGreaterThan(0);
},130_000);
