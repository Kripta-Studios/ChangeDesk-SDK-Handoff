import { hashCanonical, planHash } from "../core/hashing.js";
import type { CompiledPlan, CompiledPlanBody, ProductSnapshot, Recipe } from "./types.js";
import type { PlanExclusion } from "@changedesk/contracts";
import type { EvidenceStatus } from "@changedesk/contracts";

const EFFECT_CAPABILITIES = new Set([
  "medusa.product_categories.products.add",
  "medusa.sales_channels.products.add",
]);

export class PlanCompileError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export interface CompilePlanInput {
  planId: string; tenantId: string; actorId: string; requestId: string; artifactHash: string;
  adapterVersion: string; policyVersion: string; capabilityManifestHash: string; recipe: Recipe;
  parameters: Readonly<Record<string, string>>; selectedProductIds: readonly string[];
  readableProducts: readonly ProductSnapshot[]; expiresAt: string; planVersion: number; priorExecutionId?: string;
  proofPolicy: { proofRequired: boolean; evidenceStatus: EvidenceStatus; evidenceRefs: readonly string[] };
}

export function compilePlan(input: CompilePlanInput): CompiledPlan {
  if (input.selectedProductIds.length > 100) throw new PlanCompileError("selection_limit", "Selection exceeds 100 records");
  if (new Set(input.selectedProductIds).size !== input.selectedProductIds.length) throw new PlanCompileError("duplicate_selection", "Selection contains duplicate ids");
  validateRecipe(input.recipe, input.parameters);
  if (input.proofPolicy.proofRequired && input.proofPolicy.evidenceStatus !== "passed") throw new PlanCompileError("proof_required", "Required evidence is not passed");
  const byId = new Map(input.readableProducts.map((product) => [product.id, product]));
  if (input.selectedProductIds.some((id) => !byId.has(id))) throw new PlanCompileError("selection_not_authorized", "The complete selection is not readable");

  const products = [...input.selectedProductIds].sort().map((id) => byId.get(id)!);
  const exclusions: PlanExclusion[] = [];
  for (const product of products) {
    if (product.status !== "published") exclusions.push({ recordId: product.id, reason: "status" });
    else if (product.blocked) exclusions.push({ recordId: product.id, reason: "policy" });
  }
  const eligible = products.filter((product) => product.status === "published" && !product.blocked);
  const effects = eligible.flatMap((product) => {
    const categoryIds = new Set(product.categoryIds);
    const channelIds = new Set(product.channelIds);
    return input.recipe.steps.map((step) => {
      const args = resolveArguments(step.arguments, product.id, input.parameters);
      const categories = step.capability === "medusa.product_categories.products.add";
      const relationId = categories ? args.categoryId! : args.channelId!;
      const relations = categories ? categoryIds : channelIds;
      const alreadyPresent = relations.has(relationId);
      const preconditionFingerprint = stepPreconditionFingerprint(product.protectedDigest, categoryIds, channelIds);
      if (!alreadyPresent) relations.add(relationId);
      return { recordId: product.id, stepId: step.id, capability: step.capability, arguments: args,
        expected: alreadyPresent ? "no_op" as const : "apply" as const, preconditionFingerprint };
    });
  });
  const body: CompiledPlanBody = {
    schemaVersion: "1.0", id: input.planId, tenantId: input.tenantId, actorId: input.actorId, requestId: input.requestId,
    artifactHash: input.artifactHash, adapterVersion: input.adapterVersion,
    policyVersion: input.policyVersion, capabilityManifestHash: input.capabilityManifestHash,
    parameters: Object.fromEntries(Object.entries(input.parameters).sort(([a], [b]) => a.localeCompare(b))),
    selectionSnapshot: eligible.map(({ id, protectedDigest, categoryIds, channelIds }) => ({ productId: id, preconditionFingerprint: stepPreconditionFingerprint(protectedDigest, new Set(categoryIds), new Set(channelIds)) })),
    perRecordEffects: effects, exclusions,
    limits: { maxRecords: 100, maxSteps: 12 }, expiresAt: input.expiresAt, evidenceRefs: [...input.proofPolicy.evidenceRefs].sort(),
    planVersion: input.planVersion, ...(input.priorExecutionId ? { priorExecutionId: input.priorExecutionId } : {}),
  };
  return { ...body, planHash: planHash(body) };
}

function stepPreconditionFingerprint(protectedDigest: string, categoryIds: ReadonlySet<string>, channelIds: ReadonlySet<string>): string {
  return hashCanonical("medusa-step-precondition", "1", { protectedDigest, categoryIds: [...categoryIds].sort(), channelIds: [...channelIds].sort() });
}

function resolveArguments(spec: Recipe["steps"][number]["arguments"], productId: string, parameters: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(spec).map(([key, ref]) => {
    if ("$record" in ref) return [key, productId];
    const value = parameters[ref.$param];
    if (!value) throw new PlanCompileError("missing_parameter", `Missing parameter ${ref.$param}`);
    return [key, value];
  }).sort((left, right) => left[0]!.localeCompare(right[0]!)));
}

function validateRecipe(recipe: Recipe, parameters: Readonly<Record<string, string>>): void {
  if (recipe.steps.length < 1 || recipe.steps.length > 12) throw new PlanCompileError("invalid_recipe", "Recipe step limit violated");
  const ids = new Set<string>();
  for (const step of recipe.steps) {
    if (!EFFECT_CAPABILITIES.has(step.capability)) throw new PlanCompileError("unknown_capability", "Capability is not executable");
    if (ids.has(step.id) || step.dependsOn.some((id) => !ids.has(id))) throw new PlanCompileError("invalid_dag", "Dependencies must point to earlier unique steps");
    ids.add(step.id);
    for (const ref of Object.values(step.arguments)) if ("$param" in ref && !(ref.$param in parameters)) throw new PlanCompileError("missing_parameter", `Missing parameter ${ref.$param}`);
  }
}
