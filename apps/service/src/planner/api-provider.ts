import type { PlannerInput, PlannerProvider, ProviderProposal, ProviderUsage } from "./types.js";
import { PlannerProviderError } from "./types.js";

export interface ApiProviderConfig {
  readonly provider:"openai"|"deepseek"|"opencode";
  readonly endpoint:string;
  readonly model:string;
  readonly apiKeyEnvironmentName:string;
  readonly maxCalls:number;
  readonly maxOutputTokens:number;
  readonly timeoutMs:number;
  readonly authorizedBudgetUsd:number;
  readonly tariff?:{inputPerMillionUsd:number;outputPerMillionUsd:number;date:string};
  readonly protocol:"responses"|"chat-completions";
}
export interface SecretResolver { get(name:string):Promise<string|null>; }

export const VERIFIED_API_CONFIGS = {
  openaiLuna:{provider:"openai",endpoint:"https://api.openai.com/v1/responses",model:"gpt-6-luna",apiKeyEnvironmentName:"OPENAI_API_KEY",protocol:"responses"},
  deepseekFlash:{provider:"deepseek",endpoint:"https://api.deepseek.com/responses",model:"deepseek-flash",apiKeyEnvironmentName:"DEEPSEEK_API_KEY",protocol:"responses"},
  openCodeDeepseekFlash:{provider:"opencode",endpoint:"https://opencode.ai/zen/go/v1/chat/completions",model:"deepseek-v4.1-flash",apiKeyEnvironmentName:"OPENCODE_API_KEY",protocol:"chat-completions"},
} as const;

export class BudgetedApiPlannerProvider implements PlannerProvider {
  readonly id;
  constructor(private readonly config:ApiProviderConfig,_secrets:SecretResolver,_fetchImpl:typeof fetch=fetch,_clock=()=>performance.now()){
    this.id=config.provider;
    const expected=Object.values(VERIFIED_API_CONFIGS).find((entry)=>entry.provider===config.provider);
    if(!expected || config.endpoint!==expected.endpoint || config.model!==expected.model || config.protocol!==expected.protocol || new URL(config.endpoint).protocol!=="https:") throw new PlannerProviderError("API_PROVIDER_CONFIG_INVALID","API provider endpoint/model must match the reviewed explicit configuration",false);
  }
  async generate(_input:PlannerInput,_signal?:AbortSignal):Promise<{proposal:ProviderProposal;usage:ProviderUsage}> {
    if(this.config.authorizedBudgetUsd<=0) throw new PlannerProviderError("API_BUDGET_NOT_AUTHORIZED","API spending requires an explicit positive budget",false);
    if(!this.config.tariff) throw new PlannerProviderError("API_TARIFF_REQUIRED","Unknown API price cannot be treated as zero",false);
    throw new PlannerProviderError("API_PROVIDER_NOT_LIVE_VERIFIED","API provider is configured for a future credentialed gate but is not enabled",false);
  }
}
