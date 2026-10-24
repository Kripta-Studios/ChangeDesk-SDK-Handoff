import * as Ajv2020Module from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import * as addFormatsModule from "ajv-formats";

export function createSchemaCompiler() {
  const Ajv2020 = Ajv2020Module.default;
  const addFormats = addFormatsModule.default;
  const ajv = new Ajv2020({ strict: true, allErrors: true, removeAdditional: false, coerceTypes: false });
  addFormats(ajv);
  return ({ schema }: { schema: AnySchema }) => ajv.compile(schema);
}

const id = { type: "string", minLength: 1, maxLength: 120 } as const;
const uuid = { type: "string", format: "uuid" } as const;
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" } as const;
const empty = { type: "object", properties: {}, additionalProperties: false } as const;
export const paramsId = { type: "object", properties: { id }, required: ["id"], additionalProperties: false } as const;
export const schemas = {
  sessionExchange: { type: "object", properties: { ticket: { type: "string", minLength: 1, maxLength: 4096 } }, required: ["ticket"], additionalProperties: false },
  request: { type: "object", properties: { message: { type: "string", minLength: 1, maxLength: 4000 }, selectedProductIds: { type: "array", maxItems: 100, uniqueItems: true, items: id }, locale: { enum: ["es", "en"] }, clientRequestId: uuid }, required: ["message", "selectedProductIds", "clientRequestId"], additionalProperties: false },
  message: { type: "object", properties: { message: { type: "string", minLength: 1, maxLength: 4000 }, clientRequestId: uuid }, required: ["message", "clientRequestId"], additionalProperties: false },
  candidate: { type: "object", properties: { candidateId: id, version: { type: "integer", minimum: 1 }, choice: { enum: ["reuse", "adapt"] } }, required: ["candidateId", "version", "choice"], additionalProperties: false },
  resourceParams: { type: "object", properties: { kind: { enum: ["category", "channel"] } }, required: ["kind"], additionalProperties: false },
  resourceQuery: { type: "object", properties: { cursor: { type: "string", maxLength: 1000 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
  plan: { type: "object", properties: { requestId: id, installationId: id, selectedProductIds: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, items: id }, parameters: { type: "object", properties: { categoryId: id, channelId: id }, minProperties: 1, maxProperties: 2, additionalProperties: false }, priorExecutionId: id }, required: ["requestId", "installationId", "selectedProductIds", "parameters"], additionalProperties: false },
  approval: { type: "object", properties: { planId: id, planHash: hash, expectedPlanVersion: { type: "integer", minimum: 1 }, idempotencyKey: uuid }, required: ["planId", "planHash", "expectedPlanVersion", "idempotencyKey"], additionalProperties: false },
  execution: { type: "object", properties: { approvalId: id, idempotencyKey: uuid }, required: ["approvalId", "idempotencyKey"], additionalProperties: false },
  installation: { type: "object", properties: { artifactHash: hash, configuration: { type: "object", maxProperties: 20, additionalProperties: { anyOf: [{ type: "string" }, { type: "boolean" }, { type: "integer" }] } } }, required: ["artifactHash", "configuration"], additionalProperties: false },
  publication: { type: "object", properties: { artifactHash: hash, visibility: { enum: ["provider_catalog", "shared_allowlist"] }, consent: { const: true }, allowedTenantIds: { type: "array", maxItems: 100, uniqueItems: true, items: id } }, required: ["artifactHash", "visibility", "consent"], additionalProperties: false },
  revoke: { type: "object", properties: { reason: { type: "string", minLength: 1, maxLength: 500 } }, required: ["reason"], additionalProperties: false },
  empty,
} as const;
