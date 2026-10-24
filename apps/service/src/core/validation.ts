import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type { ApprovalRequestInput, IdempotencyKey, Recipe, RequestInput, ValidationIssue, ValidationResult } from "@changedesk/contracts";
import { approvalRequestSchema, recipeSchema, requestSchema } from "@changedesk/contracts/schemas";

const MAX_CONTRACT_BYTES = 64 * 1024;
const MAX_JSON_DEPTH = 20;
const MAX_JSON_NODES = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const issue = (code: string, path: string, message: string): ValidationIssue => Object.freeze({ code, path, message });

function inspectJson(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ancestors = new Set<object>();
  let nodes = 0;
  const visit = (current: unknown, path: string, depth: number): void => {
    if (++nodes > MAX_JSON_NODES) { issues.push(issue("input.nodes", path, `JSON exceeds ${MAX_JSON_NODES} nodes`)); return; }
    if (depth > MAX_JSON_DEPTH) { issues.push(issue("input.depth", path, `JSON exceeds depth ${MAX_JSON_DEPTH}`)); return; }
    if (typeof current === "number" && !Number.isFinite(current)) { issues.push(issue("input.number", path, "JSON numbers must be finite")); return; }
    if (typeof current === "string" && /[\uD800-\uDFFF]/u.test(current.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, ""))) { issues.push(issue("input.unicode", path, "JSON strings must not contain lone surrogate code points")); return; }
    if (current === null || ["string", "number", "boolean"].includes(typeof current)) return;
    if (typeof current !== "object") { issues.push(issue("input.json", path, "Value is not JSON-compatible")); return; }
    if (ancestors.has(current)) { issues.push(issue("input.circular", path, "Circular JSON is forbidden")); return; }
    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) { issues.push(issue("input.json", path, "Only plain JSON objects are accepted")); return; }
    const ownKeys = Reflect.ownKeys(current);
    const keys = Object.keys(current);
    if (ownKeys.some((key) => typeof key !== "string") || ownKeys.some((key) => key !== "length" && !keys.includes(key as string))) { issues.push(issue("input.json", path, "Only enumerable string-keyed JSON properties are accepted")); return; }
    if (Array.isArray(current) && (keys.length !== current.length || keys.some((key, index) => key !== String(index)))) { issues.push(issue("input.json", path, "Sparse arrays and named array properties are forbidden")); return; }
    ancestors.add(current);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) { issues.push(issue("input.json", `${path}/${key}`, "JSON accessors are forbidden")); continue; }
      visit(descriptor.value, `${path}/${key}`, depth + 1);
    }
    ancestors.delete(current);
  };
  visit(value, "", 0);
  if (issues.length === 0) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) issues.push(issue("input.json", "", "Value is not JSON-compatible"));
    else if (Buffer.byteLength(encoded, "utf8") > MAX_CONTRACT_BYTES) issues.push(issue("input.size", "", `JSON exceeds ${MAX_CONTRACT_BYTES} bytes`));
  }
  return issues;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
const detached = <T>(value: unknown): T => deepFreeze(structuredClone(value) as T);
const fromAjv = (errors: ErrorObject[] | null | undefined): ValidationIssue[] =>
  (errors ?? []).map((error) => issue("schema.invalid", error.instancePath, `${error.keyword}: ${error.message ?? "invalid"}`));

type ParameterName = "categoryId" | "channelId";
type Mutation = Recipe["steps"][number]["capability"];
type Form = { readonly parameters: readonly ParameterName[]; readonly mutations: readonly Mutation[]; readonly capabilities: readonly Recipe["requiredCapabilities"][number][] };
const BASE = ["medusa.products.list", "medusa.products.retrieve"] as const;
const FORMS: Readonly<Record<Recipe["recipeKey"], Form>> = {
  "catalog.category.assign.v1": { parameters: ["categoryId"], mutations: ["medusa.product_categories.products.add"], capabilities: [...BASE, "medusa.product_categories.retrieve", "medusa.product_categories.products.add"] },
  "catalog.channel.assign.v1": { parameters: ["channelId"], mutations: ["medusa.sales_channels.products.add"], capabilities: [...BASE, "medusa.sales_channels.retrieve", "medusa.sales_channels.products.add"] },
  "catalog.campaign.prepare.v1": { parameters: ["categoryId", "channelId"], mutations: ["medusa.product_categories.products.add", "medusa.sales_channels.products.add"], capabilities: [...BASE, "medusa.product_categories.retrieve", "medusa.sales_channels.retrieve", "medusa.product_categories.products.add", "medusa.sales_channels.products.add"] },
};
const sameSet = (actual: readonly string[], expected: readonly string[]): boolean =>
  actual.length === expected.length && new Set(actual).size === actual.length && expected.every((item) => actual.includes(item));

export function validateRecipeSemantics(recipe: Recipe, verifiedMedusaVersion = "2.22.1"): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const form = FORMS[recipe.recipeKey];
  if (recipe.compatibility.verifiedMedusaVersion !== verifiedMedusaVersion) issues.push(issue("recipe.compatibility", "/compatibility/verifiedMedusaVersion", "Recipe version does not match the server-verified adapter profile"));
  if (!sameSet(Object.keys(recipe.parameters), form.parameters)) issues.push(issue("recipe.parameters", "/parameters", "Parameters must exactly match the recipe form"));
  if (!sameSet(recipe.requiredCapabilities, form.capabilities)) issues.push(issue("recipe.capabilities", "/requiredCapabilities", "Capabilities must exactly equal the required read/write closure"));
  if (!sameSet(recipe.steps.map((step) => step.capability), form.mutations)) issues.push(issue("recipe.form", "/steps", "Mutation steps must exactly match the recipe form"));
  const seen = new Set<string>();
  for (const [index, step] of recipe.steps.entries()) {
    const path = `/steps/${index}`;
    if (seen.has(step.id)) issues.push(issue("recipe.step_id", `${path}/id`, "Step IDs must be unique"));
    for (const dependency of step.dependsOn) if (!seen.has(dependency)) issues.push(issue("recipe.dependency", `${path}/dependsOn`, "Dependencies must reference prior steps in the same record"));
    seen.add(step.id);
    const parameter = step.capability === "medusa.product_categories.products.add" ? "categoryId" : "channelId";
    if (!sameSet(Object.keys(step.arguments), ["productId", parameter])) issues.push(issue("recipe.arguments", `${path}/arguments`, "Arguments do not match the capability signature"));
    if (JSON.stringify(step.arguments.productId) !== '{"$record":"id"}') issues.push(issue("recipe.reference", `${path}/arguments/productId`, "productId must reference the current record ID"));
    if (JSON.stringify(step.arguments[parameter]) !== `{"$param":"${parameter}"}`) issues.push(issue("recipe.reference", `${path}/arguments/${parameter}`, `${parameter} must reference its matching parameter`));
  }
  if (!sameSet(recipe.ui.fields.map((field) => field.name), form.parameters)) issues.push(issue("recipe.ui", "/ui/fields", "UI fields must exactly match consumed parameters and be unique"));
  return Object.freeze(issues);
}

function validateWith<T>(validate: ValidateFunction, value: unknown): ValidationResult<T> {
  const inputIssues = inspectJson(value);
  if (inputIssues.length > 0) return { ok: false, issues: Object.freeze(inputIssues) };
  if (!validate(value)) return { ok: false, issues: Object.freeze(fromAjv(validate.errors)) };
  return { ok: true, value: detached<T>(value) };
}

export interface ContractValidator {
  validateRecipeSyntax(value: unknown): ValidationResult<Recipe>;
  validateRecipe(value: unknown): ValidationResult<Recipe>;
  validateRequest(value: unknown): ValidationResult<RequestInput>;
  validateApprovalRequest(value: unknown): ValidationResult<ApprovalRequestInput>;
}

export function validateIdempotencyMatch(headerValue: string | undefined, bodyValue: string): ValidationResult<IdempotencyKey> {
  if (!headerValue) return { ok: false, issues: [issue("idempotency.missing", "/headers/idempotency-key", "Idempotency-Key is required for control mutations")] };
  if (!UUID_PATTERN.test(headerValue)) return { ok: false, issues: [issue("idempotency.format", "/headers/idempotency-key", "Idempotency-Key must be a UUID")] };
  if (headerValue !== bodyValue) return { ok: false, issues: [issue("idempotency.mismatch", "/idempotencyKey", "Body idempotencyKey must exactly match the Idempotency-Key header")] };
  return { ok: true, value: headerValue };
}

export function createContractValidator(options: { readonly verifiedMedusaVersion?: string } = {}): ContractValidator {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  ajv.addFormat("uuid", UUID_PATTERN);
  const recipe = ajv.compile(recipeSchema);
  const request = ajv.compile(requestSchema);
  const approval = ajv.compile(approvalRequestSchema);
  const validateRecipeSyntax = (value: unknown): ValidationResult<Recipe> => validateWith<Recipe>(recipe, value);
  return Object.freeze({
    validateRecipeSyntax,
    validateRecipe(value: unknown): ValidationResult<Recipe> {
      const syntax = validateRecipeSyntax(value);
      if (!syntax.ok) return syntax;
      const issues = validateRecipeSemantics(syntax.value, options.verifiedMedusaVersion);
      return issues.length === 0 ? syntax : { ok: false, issues };
    },
    validateRequest: (value: unknown) => validateWith<RequestInput>(request, value),
    validateApprovalRequest: (value: unknown) => validateWith<ApprovalRequestInput>(approval, value),
  });
}
