import type { PlannerInput, ProviderUsage } from "./types.js";

export interface GenerationCallToken { readonly reservationId:string;readonly fence:bigint;readonly attempt:number; }
export interface GenerationUsageLedger {
  reserveCall(input:{tenantId:string;actorId:string;requestId:string;intentHash:string;contractVersion:"1";provider:string;model:string;maxAttempts:1|2|3;tokenBudget:bigint;costBudgetMicros:bigint;leaseOwner:string;leaseSeconds:number}):Promise<GenerationCallToken|null>;
  recordCall(scope:{tenantId:string;actorId:string},token:GenerationCallToken,input:{inputTokens:bigint;outputTokens:bigint;usedCostMicros:bigint;retryable:boolean;success:boolean}):Promise<boolean>;
}
interface GenerationBudgetTx {reserveCall(input:Parameters<GenerationUsageLedger["reserveCall"]>[0]):ReturnType<GenerationUsageLedger["reserveCall"]>;recordCall(scope:Parameters<GenerationUsageLedger["recordCall"]>[0],token:GenerationCallToken,input:Parameters<GenerationUsageLedger["recordCall"]>[2]):Promise<boolean>;}
interface GenerationBudgetStore {withTenant<T>(scope:{tenantId:string;actorId:string},work:(tx:GenerationBudgetTx)=>Promise<T>):Promise<T>;}

export class PostgresGenerationUsageLedger implements GenerationUsageLedger {
  constructor(private readonly store:GenerationBudgetStore){}
  reserveCall(input:Parameters<GenerationUsageLedger["reserveCall"]>[0]){return this.store.withTenant(input,(tx)=>tx.reserveCall(input));}
  recordCall(scope:Parameters<GenerationUsageLedger["recordCall"]>[0],token:GenerationCallToken,input:Parameters<GenerationUsageLedger["recordCall"]>[2]){return this.store.withTenant(scope,(tx)=>tx.recordCall(scope,token,input));}
}

export interface GenerationBudgetConfig {readonly provider:string;readonly model:string;readonly maxAttempts:1|2|3;readonly tokenBudget:bigint;readonly costBudgetMicros:bigint;readonly leaseSeconds:number;intentHash(input:PlannerInput):Promise<string>;}
export function usageTotals(usage:readonly ProviderUsage[]){let input=0n,output=0n,cost=0n;for(const item of usage){input+=BigInt(item.inputTokens??0);output+=BigInt(item.outputTokens??0);if(item.price?.currency==="USD")cost+=BigInt(Math.ceil(item.price.value*1_000_000));}return{inputTokens:input,outputTokens:output,usedCostMicros:cost};}
