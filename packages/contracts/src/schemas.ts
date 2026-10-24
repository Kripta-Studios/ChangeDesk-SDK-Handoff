/** Reviewed developer-owned JSON Schemas. Never pass model/user supplied schemas to Ajv. */
const uuid = { type: "string", format: "uuid" } as const;
const resourceReference = {
  oneOf: [
    { type: "object", properties: { $param: { enum: ["categoryId", "channelId"] } }, required: ["$param"], additionalProperties: false },
    { type: "object", properties: { $record: { const: "id" } }, required: ["$record"], additionalProperties: false },
  ],
} as const;

export const recipeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://changedesk.invalid/schemas/recipe-v1",
  title: "Change Desk Recipe IR v1 (Medusa pilot)",
  type: "object",
  properties: {
    schemaVersion: { const: "1.0" },
    recipeKey: { enum: ["catalog.campaign.prepare.v1", "catalog.category.assign.v1", "catalog.channel.assign.v1"] },
    displayName: { type: "string", minLength: 1, maxLength: 80 },
    description: { type: "string", minLength: 1, maxLength: 500 },
    compatibility: {
      type: "object",
      properties: {
        adapter: { const: "medusa-v2" }, capabilityContract: { const: "1" },
        verifiedMedusaVersion: { type: "string", minLength: 1, maxLength: 30 },
      },
      required: ["adapter", "capabilityContract", "verifiedMedusaVersion"], additionalProperties: false,
    },
    parameters: {
      type: "object",
      properties: {
        categoryId: { type: "object", properties: { kind: { const: "resource" }, resource: { const: "medusa.product_category" } }, required: ["kind", "resource"], additionalProperties: false },
        channelId: { type: "object", properties: { kind: { const: "resource" }, resource: { const: "medusa.sales_channel" } }, required: ["kind", "resource"], additionalProperties: false },
      },
      required: [], additionalProperties: false, minProperties: 1,
    },
    selection: {
      type: "object",
      properties: { resource: { const: "medusa.product" }, maxRecords: { type: "integer", minimum: 1, maximum: 100 }, requireStatus: { const: "published" } },
      required: ["resource", "maxRecords", "requireStatus"], additionalProperties: false,
    },
    requiredCapabilities: {
      type: "array", uniqueItems: true, minItems: 4, maxItems: 6,
      items: { enum: ["medusa.products.list", "medusa.products.retrieve", "medusa.product_categories.retrieve", "medusa.sales_channels.retrieve", "medusa.product_categories.products.add", "medusa.sales_channels.products.add"] },
    },
    steps: { type: "array", minItems: 1, maxItems: 12, items: { $ref: "#/$defs/step" } },
    ui: {
      type: "object",
      properties: {
        kind: { const: "action" }, label: { type: "string", minLength: 1, maxLength: 60 },
        fields: {
          type: "array", minItems: 1, maxItems: 2,
          items: {
            type: "object", properties: { name: { enum: ["categoryId", "channelId"] }, control: { const: "resource-picker" }, label: { type: "string", minLength: 1, maxLength: 80 } },
            required: ["name", "control", "label"], additionalProperties: false,
          },
        },
      },
      required: ["kind", "label", "fields"], additionalProperties: false,
    },
  },
  required: ["schemaVersion", "recipeKey", "displayName", "description", "compatibility", "parameters", "selection", "requiredCapabilities", "steps", "ui"],
  additionalProperties: false,
  $defs: {
    reference: resourceReference,
    step: {
      type: "object",
      properties: {
        id: { type: "string", pattern: "^[a-z][a-zA-Z0-9]{0,31}$" },
        capability: { enum: ["medusa.product_categories.products.add", "medusa.sales_channels.products.add"] },
        forEach: { const: "selectedProducts" },
        dependsOn: { type: "array", maxItems: 11, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 32 } },
        arguments: {
          type: "object",
          properties: { productId: { $ref: "#/$defs/reference" }, categoryId: { $ref: "#/$defs/reference" }, channelId: { $ref: "#/$defs/reference" } },
          required: ["productId"], additionalProperties: false, minProperties: 2, maxProperties: 2,
        },
      },
      required: ["id", "capability", "forEach", "dependsOn", "arguments"], additionalProperties: false,
    },
  },
} as const;

export const requestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://changedesk.invalid/schemas/request-v1",
  title: "Untrusted browser create request body",
  type: "object",
  properties: {
    message: { type: "string", minLength: 1, maxLength: 4000 },
    selectedProductIds: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 120 } },
    locale: { enum: ["es", "en"] }, clientRequestId: uuid,
  },
  required: ["message", "selectedProductIds", "clientRequestId"], additionalProperties: false,
} as const;

export const approvalRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://changedesk.invalid/schemas/approval-request-v1",
  title: "Approval submission: identity and authority added server-side",
  type: "object",
  properties: {
    planId: { type: "string", minLength: 1, maxLength: 120 },
    planHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    expectedPlanVersion: { type: "integer", minimum: 1 }, idempotencyKey: uuid,
  },
  required: ["planId", "planHash", "expectedPlanVersion", "idempotencyKey"], additionalProperties: false,
} as const;
