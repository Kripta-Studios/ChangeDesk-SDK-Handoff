import type { PlannerInput, PlannerProvider, ProviderUsage } from "./types.js";
import { PlannerProviderError } from "./types.js";

export interface GenerationCallToken { readonly reservationId:string;readonly fence:bigint;readonly attempt:number; }
export interface GenerationUsageLedger {
  reserveCall(input:{tenantId:string;actorId:string;requestId:string;intentHash:string;contractVersion:"1";provider:string;model:string;maxAttempts:number;totalTokenBudget:bigint;perCallTokenBudget:bigint;costBudgetMicros:bigint}):Promise<GenerationCallToken|null>;
  recordCall(input:{tenantId:string;actorId:string;requestId:string;token:GenerationCallToken;usage:readonly ProviderUsage[];success:boolean;retryable:boolean}):Promise<boolean>;
}
export interface DurableBudgetConfig {
  readonly model:string;readonly maxAttempts:1|2|3;readonly totalTokenBudget:bigint;readonly perCallTokenBudget:bigint;readonly costBudgetMicros:bigint;
  intentHash(input:PlannerInput):Promise<string>;
}

/** Wrap every real provider invocation; the durable ledger, not process memory, owns the request-wide cap. */
export class DurablyBudgetedPlannerProvider implements PlannerProvider {
  readonly id;
  constructor(private readonly inner:PlannerProvider,private readonly ledger:GenerationUsageLedger,private readonly config:DurableBudgetConfig){this.id=inner.id;}
  async generate(input:PlannerInput,signal?:AbortSignal){
    const token=await this.ledger.reserveCall({tenantId:input.tenantId,actorId:input.actorId,requestId:input.requestId,intentHash:await this.config.intentHash(input),contractVersion:"1",provider:this.inner.id,model:this.config.model,maxAttempts:this.config.maxAttempts,totalTokenBudget:this.config.totalTokenBudget,perCallTokenBudget:this.config.perCallTokenBudget,costBudgetMicros:this.config.costBudgetMicros});
    if(!token)throw new PlannerProviderError("PROVIDER_CALL_BUDGET_EXHAUSTED","The durable request-wide provider budget is exhausted",false);
    let generated:Awaited<ReturnType<PlannerProvider["generate"]>>;
    try{generated=await this.inner.generate(input,signal);}catch(error){
      const usage=error instanceof PlannerProviderError?error.usage:[];
      const retryable=error instanceof PlannerProviderError&&error.retryable;
      if(!await this.ledger.recordCall({tenantId:input.tenantId,actorId:input.actorId,requestId:input.requestId,token,usage,success:false,retryable}))throw new PlannerProviderError("GENERATION_LEDGER_STALE","Failed provider usage could not be durably recorded",false,[...usage]);
      throw error;
    }
    if(!await this.ledger.recordCall({tenantId:input.tenantId,actorId:input.actorId,requestId:input.requestId,token,usage:[generated.usage],success:true,retryable:false}))throw new PlannerProviderError("GENERATION_LEDGER_STALE","Provider usage could not be durably recorded",false,[generated.usage]);
    return generated;
  }
}
