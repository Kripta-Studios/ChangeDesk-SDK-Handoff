import { BridgeError } from "./errors.ts"
import { sha256Json } from "./crypto.ts"
import {
  CAPABILITY_IDS,
  EFFECT_CAPABILITIES,
  READ_CAPABILITIES,
  type ActorPolicy,
  type BootstrapClaims,
  type BridgeCommand,
  type CapabilityId,
  type DelegationClaims,
  type EffectDelegationClaims,
  type ReconcileDelegationClaims,
  type ReadDelegationClaims,
} from "./types.ts"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  const actual = Object.keys(value).sort()
  const expected = [...allowed].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new BridgeError(400, "invalid_command", "Command contains missing or unknown fields")
  }
}

const claimString = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.length < 1 || value.length > 500) {
    throw new BridgeError(401, "invalid_claims", `${name} is invalid`)
  }
}

const COMMON_CLAIMS = ["v", "typ", "iss", "aud", "tenantId", "actorId", "hostSessionId", "policyVersion", "adapterVersion", "capability", "argsHash", "jti", "iat", "exp"] as const

export const parseDelegationClaims = (value: unknown): DelegationClaims => {
  if (!isRecord(value)) throw new BridgeError(401, "invalid_claims", "Claims must be an object")
  if (!["changedesk.read", "changedesk.effect", "changedesk.reconcile"].includes(String(value.typ))) {
    throw new BridgeError(401, "invalid_claims", "Unknown delegation type")
  }
  const reconcileKeys = ["v", "typ", "iss", "aud", "tenantId", "adapterVersion", "executionId", "rowId", "stepId", "operationKey", "capability", "argsHash", "semanticInputHash", "jti", "iat", "exp"]
  const readKeys = [...COMMON_CLAIMS, "requestId"]
  const effectKeys = [...COMMON_CLAIMS, "executionId", "rowId", "stepId", "planId", "planHash", "planVersion", "approvalId", "approvalExpiresAt", "semanticInputHash", "operationKey", "fence", "preconditions"]
  exactKeys(value, value.typ === "changedesk.reconcile" ? reconcileKeys : value.typ === "changedesk.read" ? readKeys : effectKeys)
  if (value.v !== 1 || value.adapterVersion !== "medusa-2.22.1/changedesk-1" ||
      !CAPABILITY_IDS.includes(value.capability as CapabilityId) ||
      !Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp) ||
      (value.exp as number) <= (value.iat as number) || (value.exp as number) - (value.iat as number) > 60) {
    throw new BridgeError(401, "invalid_claims", "Claim version, capability, or timestamps are invalid")
  }
  for (const key of ["iss", "aud", "tenantId", "adapterVersion", "capability", "argsHash", "jti"] as const) claimString(value[key], key)
  if (value.typ === "changedesk.reconcile") {
    for (const key of ["executionId", "rowId", "stepId", "operationKey", "semanticInputHash"] as const) claimString(value[key], key)
    return value as ReconcileDelegationClaims
  }
  for (const key of ["actorId", "hostSessionId", "policyVersion"] as const) claimString(value[key], key)
  if (value.typ === "changedesk.read") {
    claimString(value.requestId, "requestId")
    return value as unknown as DelegationClaims
  }
  for (const key of ["executionId", "rowId", "stepId", "planId", "planHash", "approvalId", "semanticInputHash", "operationKey"] as const) claimString(value[key], key)
  if (!Number.isSafeInteger(value.planVersion) || !Number.isSafeInteger(value.approvalExpiresAt) || !Number.isSafeInteger(value.fence) || !isRecord(value.preconditions)) {
    throw new BridgeError(401, "invalid_claims", "Effect numeric claims or preconditions are invalid")
  }
  exactKeys(value.preconditions, ["productStatus", "productUnlocked", "relationAbsent", "preconditionFingerprint"])
  claimString(value.preconditions.preconditionFingerprint, "preconditionFingerprint")
  return value as unknown as DelegationClaims
}

const boundedId = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > 120) {
    throw new BridgeError(400, "invalid_command", `${name} must be a bounded identifier`)
  }
  return value
}

export const parseCommand = (value: unknown): BridgeCommand => {
  if (!isRecord(value)) throw new BridgeError(400, "invalid_command", "Command must be an object")
  exactKeys(value, ["capability", "args"])
  if (!CAPABILITY_IDS.includes(value.capability as CapabilityId) || !isRecord(value.args)) {
    throw new BridgeError(400, "invalid_command", "Unknown capability or invalid args")
  }
  const capability = value.capability as CapabilityId
  const args = value.args
  switch (capability) {
    case "medusa.products.list": {
      const keys = args.ids === undefined ? ["limit"] : ["ids", "limit"]
      exactKeys(args, keys)
      if (!Number.isInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > 100) {
        throw new BridgeError(400, "invalid_command", "limit must be between 1 and 100")
      }
      if (args.ids !== undefined && (!Array.isArray(args.ids) || args.ids.length > 100)) {
        throw new BridgeError(400, "invalid_command", "ids must contain at most 100 items")
      }
      const ids = args.ids?.map((id) => boundedId(id, "productId"))
      if (ids && new Set(ids).size !== ids.length) {
        throw new BridgeError(400, "invalid_command", "ids must be unique")
      }
      return { capability, args: { limit: args.limit as number, ...(ids ? { ids } : {}) } }
    }
    case "medusa.products.retrieve":
      exactKeys(args, ["productId"])
      return { capability, args: { productId: boundedId(args.productId, "productId") } }
    case "medusa.product_categories.retrieve":
      exactKeys(args, ["categoryId"])
      return { capability, args: { categoryId: boundedId(args.categoryId, "categoryId") } }
    case "medusa.sales_channels.retrieve":
      exactKeys(args, ["channelId"])
      return { capability, args: { channelId: boundedId(args.channelId, "channelId") } }
    case "medusa.product_categories.products.add":
      exactKeys(args, ["productId", "categoryId"])
      return {
        capability,
        args: {
          productId: boundedId(args.productId, "productId"),
          categoryId: boundedId(args.categoryId, "categoryId"),
        },
      }
    case "medusa.sales_channels.products.add":
      exactKeys(args, ["productId", "channelId"])
      return {
        capability,
        args: {
          productId: boundedId(args.productId, "productId"),
          channelId: boundedId(args.channelId, "channelId"),
        },
      }
  }
}

const assertCommon = (
  claims: ReadDelegationClaims | EffectDelegationClaims,
  command: BridgeCommand,
  expected: { issuer: string; audience: string; tenantId: string; now: number }
) => {
  if (
    claims.v !== 1 ||
    claims.iss !== expected.issuer ||
    claims.aud !== expected.audience ||
    claims.tenantId !== expected.tenantId ||
    claims.adapterVersion !== "medusa-2.22.1/changedesk-1" ||
    typeof claims.actorId !== "string" ||
    typeof claims.hostSessionId !== "string" ||
    typeof claims.policyVersion !== "string" ||
    typeof claims.jti !== "string" ||
    claims.jti.length < 1 ||
    claims.exp <= expected.now ||
    claims.iat > expected.now + 5 ||
    claims.exp - claims.iat > 60 ||
    claims.capability !== command.capability ||
    claims.argsHash !== sha256Json(command.args)
  ) {
    throw new BridgeError(403, "delegation_mismatch", "Delegation does not authorize this command")
  }
}

export const authorizeDelegation = (
  claims: ReadDelegationClaims | EffectDelegationClaims,
  command: BridgeCommand,
  actor: ActorPolicy,
  expected: { issuer: string; audience: string; tenantId: string; now: number }
) => {
  assertCommon(claims, command, expected)
  if (!actor.managed || !actor.active || claims.actorId.length === 0) {
    throw new BridgeError(403, "actor_inactive", "Actor is not active")
  }
  if (
    claims.policyVersion !== actor.policyVersion ||
    claims.hostSessionId !== actor.hostSessionId
  ) {
    throw new BridgeError(403, "stale_authority", "Actor session or policy changed")
  }
  if (claims.typ === "changedesk.read") {
    if (!READ_CAPABILITIES.includes(command.capability)) {
      throw new BridgeError(403, "read_delegation_for_effect", "Read delegation cannot authorize effects")
    }
    return
  }
  if (!EFFECT_CAPABILITIES.includes(command.capability)) {
    throw new BridgeError(403, "effect_delegation_for_read", "Effect delegation cannot authorize reads")
  }
  if (actor.role !== "operator" && actor.role !== "admin") {
    throw new BridgeError(403, "role_forbidden", "Actor cannot execute effects")
  }
  const effect = claims as EffectDelegationClaims
  if ("productId" in command.args && !actor.readableProductIds.includes(command.args.productId)) {
    throw new BridgeError(404, "resource_not_found", "Resource not found")
  }
  if (
    effect.approvalExpiresAt <= expected.now ||
    effect.planVersion < 1 ||
    !effect.operationKey ||
    !effect.rowId ||
    !effect.semanticInputHash ||
    effect.preconditions.productStatus !== "published" ||
    effect.preconditions.productUnlocked !== true ||
    effect.preconditions.relationAbsent !== true
  ) {
    throw new BridgeError(409, "stale_effect_authority", "Effect authority is stale or incomplete")
  }
}

export const buildBootstrapClaims = (input: Omit<BootstrapClaims, "v" | "typ">): BootstrapClaims => {
  if (input.exp - input.iat > 60 || input.exp <= input.iat) {
    throw new BridgeError(500, "ticket_ttl_invalid", "Bootstrap ticket TTL must be at most 60 seconds")
  }
  return { v: 1, typ: "changedesk.bootstrap", ...input }
}
