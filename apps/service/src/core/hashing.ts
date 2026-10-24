import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import type { JsonValue, PlanHashInput, Recipe } from "@changedesk/contracts";

export const CANONICAL_HASH_FRAMING = Object.freeze({
  algorithm: "sha256",
  namespace: "changedesk",
  separator: "\0",
  encoding: "utf8",
  version: "1",
} as const);

function hasLoneSurrogate(value: string): boolean {
  return /[\uD800-\uDFFF]/u.test(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, ""));
}

function assertIJson(value: unknown, ancestors = new Set<object>()): void {
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("JCS only accepts finite JSON numbers");
  if (typeof value === "string" && hasLoneSurrogate(value)) throw new TypeError("JCS forbids lone surrogate code points");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (typeof value !== "object") throw new TypeError("Value is not JSON-compatible");
  if (ancestors.has(value)) throw new TypeError("Circular value is not JSON-compatible");
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new TypeError("Only plain JSON objects can be canonicalized");
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) throw new TypeError("Value has non-JSON property keys");
  const enumerableKeys = Object.keys(value);
  if (Array.isArray(value)) {
    if (enumerableKeys.length !== value.length || enumerableKeys.some((key, index) => key !== String(index))) throw new TypeError("Sparse arrays or named array properties are not valid parsed JSON");
    if (ownKeys.some((key) => key !== "length" && !enumerableKeys.includes(key as string))) throw new TypeError("Non-enumerable array properties are not valid parsed JSON");
  } else if (ownKeys.length !== enumerableKeys.length) {
    throw new TypeError("Non-enumerable object properties are not valid parsed JSON");
  }
  ancestors.add(value);
  for (const key of enumerableKeys) {
    if (hasLoneSurrogate(key)) throw new TypeError("JCS forbids lone surrogate code points in object keys");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("Accessors are not valid parsed JSON");
    assertIJson(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

export function canonicalizeJson(value: unknown): string {
  assertIJson(value);
  const result = canonicalize(value);
  if (typeof result !== "string") throw new TypeError("Value is not JSON-compatible");
  return result;
}

export function hashCanonical(domain: string, version: string, value: JsonValue | object): string {
  if (!/^[a-z][a-z0-9._-]{0,63}$/u.test(domain) || !/^[A-Za-z0-9._-]{1,32}$/u.test(version)) throw new TypeError("Invalid hash domain or version");
  const { algorithm, namespace, separator, encoding } = CANONICAL_HASH_FRAMING;
  return createHash(algorithm).update(`${namespace}${separator}${domain}${separator}${version}${separator}${canonicalizeJson(value)}`, encoding).digest("hex");
}

export const artifactHash = (recipe: Recipe): string => hashCanonical("recipe-artifact", "1", recipe);
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export function normalizePlanHashInput(input: PlanHashInput): PlanHashInput {
  const copy = structuredClone(input);
  return {
    ...copy,
    selectionSnapshot: [...copy.selectionSnapshot].sort((a, b) => compare(a.productId, b.productId) || compare(a.preconditionFingerprint, b.preconditionFingerprint)),
    perRecordEffects: [...copy.perRecordEffects].sort((a, b) => compare(a.recordId, b.recordId) || compare(a.stepId, b.stepId)),
    exclusions: [...copy.exclusions].sort((a, b) => compare(a.recordId, b.recordId) || compare(a.reason, b.reason)),
    evidenceRefs: [...copy.evidenceRefs].sort(compare),
  };
}

export const planHash = (input: PlanHashInput): string => hashCanonical("plan", "1", normalizePlanHashInput(input));
export const semanticInputHash = (input: JsonValue | object): string => hashCanonical("semantic-input", "1", input);
export const hashesEqual = (expected: string, actual: string): boolean => /^[a-f0-9]{64}$/u.test(expected) && expected === actual;
