import type { PlannerInput, PlannerPort, PlannerProvider, PlannerResult, ProviderUsage, RecipeValidator } from "./types.js";
import { PlannerProviderError } from "./types.js";

export interface PlannerOptions {
  readonly maxCalls: number;
  readonly maxMessageCharacters: number;
}

export class ValidatingPlanner implements PlannerPort {
  constructor(
    private readonly provider: PlannerProvider,
    private readonly validateRecipe: RecipeValidator,
    private readonly options: PlannerOptions = { maxCalls: 3, maxMessageCharacters: 4_000 },
  ) {
    if (!Number.isInteger(options.maxCalls) || options.maxCalls < 1 || options.maxCalls > 3) {
      throw new Error("Planner maxCalls must be an integer between 1 and 3");
    }
  }

  async plan(input: PlannerInput, signal?: AbortSignal): Promise<PlannerResult> {
    if (input.message.length < 1 || input.message.length > this.options.maxMessageCharacters) {
      return { kind: "unsupported", safeMessage: "The request is empty or exceeds the supported size.", usage: [] };
    }
    if (input.selectedProductIds.length > 100 || new Set(input.selectedProductIds).size !== input.selectedProductIds.length) {
      return { kind: "unsupported", safeMessage: "The product selection is invalid.", usage: [] };
    }

    const usage: ProviderUsage[] = [];
    try {
      for (let call = 0; call < this.options.maxCalls; call += 1) {
        if (signal?.aborted) throw new PlannerProviderError("PROVIDER_ABORTED", "Provider call aborted", true, usage);
        const generated = await this.provider.generate(input, signal);
        usage.push(generated.usage);
        if (generated.proposal.kind !== "candidate") {
          return { ...generated.proposal, usage };
        }
        const validated = this.validateRecipe(generated.proposal.recipe, input.approvedCapabilities, input.adapter);
        if (validated.ok) return { kind: "candidate", recipe: validated.recipe, usage };
      }
      return {
        kind: "unsupported",
        safeMessage: "The provider did not produce a valid recipe within the configured call budget.",
        usage,
      };
    } catch (error) {
      if (error instanceof PlannerProviderError) {
        return {
          kind: "provider_unavailable",
          safeMessage: "The configured planning provider is unavailable.",
          retryable: error.retryable,
          code: error.code,
          usage: [...usage, ...error.usage],
        };
      }
      throw error;
    }
  }
}
