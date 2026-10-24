import type { Recipe, RecipeKey } from "@changedesk/contracts";
import type { PlannerInput, PlannerProvider, ProviderUsage, StructuredIntent } from "./types.js";

export class DeterministicFakePlannerProvider implements PlannerProvider {
  readonly id = "fake" as const;
  constructor(private readonly recipes: Readonly<Record<RecipeKey, Recipe>>, private readonly now = () => performance.now()) {}

  async generate(input: PlannerInput): Promise<{ proposal: { kind: "candidate"; recipe: Recipe } | { kind: "needs_clarification"; safeMessage: string }; usage: ProviderUsage }> {
    const started = this.now();
    const key = input.structuredIntent?.recipeKey ?? operationToKey(input.structuredIntent?.operation) ?? inferText(input.message);
    const usage: ProviderUsage = {
      provider: "fake", configuredModel: "deterministic-fixture-v1", observedModel: "deterministic-fixture-v1",
      calls: 1, inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningOutputTokens: null,
      latencyMs: Math.max(0, this.now() - started), price: null, live: false,
    };
    if (!key) return { proposal: { kind: "needs_clarification", safeMessage: "Choose campaign, category, or channel." }, usage };
    return { proposal: { kind: "candidate", recipe: structuredClone(this.recipes[key]) }, usage };
  }
}

function inferText(message:string):RecipeKey|undefined {const text=message.toLocaleLowerCase("en");const category=/\b(category|categor[ií]a)\b/u.test(text),channel=/\b(channel|canal)\b/u.test(text);if(category&&channel)return "catalog.campaign.prepare.v1";if(category)return "catalog.category.assign.v1";if(channel)return "catalog.channel.assign.v1";return undefined;}

function operationToKey(operation: StructuredIntent["operation"]): RecipeKey | undefined {
  if (operation === "campaign") return "catalog.campaign.prepare.v1";
  if (operation === "assign_category") return "catalog.category.assign.v1";
  if (operation === "assign_channel") return "catalog.channel.assign.v1";
  return undefined;
}
