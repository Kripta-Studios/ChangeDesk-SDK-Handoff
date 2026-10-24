import { describe, expect, it } from "vitest"
import { generateKeyPairSync } from "node:crypto"
import { signEnvelope, sha256Json, verifyEnvelope } from "../../packages/medusa-plugin/src/bridge/crypto.ts"
import { BridgeError } from "../../packages/medusa-plugin/src/bridge/errors.ts"
import { authorizeDelegation, buildBootstrapClaims, parseCommand, parseDelegationClaims } from "../../packages/medusa-plugin/src/bridge/validation.ts"
import type { ActorPolicy, EffectDelegationClaims, ReadDelegationClaims } from "../../packages/medusa-plugin/src/bridge/types.ts"
import { protectedProductFingerprint } from "../../packages/medusa-plugin/src/bridge/protected-state.ts"

const { privateKey, publicKey } = generateKeyPairSync("ed25519")
const actor: ActorPolicy = {
  managed: true,
  active: true,
  role: "operator",
  policyVersion: "policy-1",
  hostSessionId: "host-session",
  readableProductIds: ["prod_1"],
}
const expected = { issuer: "service", audience: "atlas-plugin", tenantId: "atlas", now: 100 }

describe("bridge contract", () => {
it("argsHash matches the ADR006 NUL-framed JCS vector", () => {
  expect(
    sha256Json({ productId: "prod_1", categoryId: "pcat_1" }),
  ).toBe("52578f36f4e7ab3083bd06158123a9ca0d467bab028d3ff635ceac81dc2c1366")
})

it("protected fingerprint ignores associations but detects status and price changes", () => {
  const product = {
    id: "prod_1", title: "Desk", handle: "desk", description: "Preserve this", status: "published",
    metadata: { changedesk_locked: false }, tags: [{ id: "tag_b" }, { id: "tag_a" }],
    variants: [{ id: "variant_1", sku: "DESK-1", manage_inventory: false, prices: [{ id: "price_1", amount: 1999, currency_code: "eur" }] }],
  }
  const baseline = protectedProductFingerprint(product)
  expect(protectedProductFingerprint({ ...product, categories: [{ id: "pcat_new" }], sales_channels: [{ id: "sc_new" }] } as typeof product)).toBe(baseline)
  expect(protectedProductFingerprint({ ...product, status: "draft" })).not.toBe(baseline)
  expect(protectedProductFingerprint({ ...product, variants: [{ ...product.variants[0], prices: [{ id: "price_1", amount: 2000, currency_code: "eur" }] }] })).not.toBe(baseline)
})

const readClaims = (capability: ReadDelegationClaims["capability"], args: object): ReadDelegationClaims => ({
  v: 1,
  typ: "changedesk.read",
  iss: "service",
  aud: "atlas-plugin",
  tenantId: "atlas",
  actorId: "user-1",
  hostSessionId: "host-session",
  policyVersion: "policy-1",
  adapterVersion: "medusa-2.22.1/changedesk-1",
  capability,
  argsHash: sha256Json(args),
  jti: "jti-read",
  iat: 90,
  exp: 120,
  requestId: "request-1",
})

const effectClaims = (args: object): EffectDelegationClaims => {
  const { requestId: _requestId, ...base } = readClaims("medusa.product_categories.products.add", args)
  return ({
  ...base,
  typ: "changedesk.effect",
  executionId: "execution-1",
  jobId: "job-1",
  leaseOwner: "worker-1",
  rowId: "row-1",
  stepId: "step-1",
  planId: "plan-1",
  planHash: "a".repeat(64),
  planVersion: 1,
  approvalId: "approval-1",
  approvalExpiresAt: 150,
  semanticInputHash: "b".repeat(64),
  operationKey: "atlas/execution-1/row-1/step-1",
  fence: 7,
  preconditions: { productStatus: "published", productUnlocked: true, relationAbsent: true, preconditionFingerprint: "fixture-fingerprint" },
})
}

it("Ed25519 compact envelope detects payload tampering", () => {
  const claims = readClaims("medusa.products.retrieve", { productId: "prod_1" })
  const envelope = signEnvelope(claims, privateKey)
  expect(verifyEnvelope(envelope, publicKey)).toEqual(claims)
  const [payload, signature] = envelope.split(".")
  const tampered = `${payload.slice(0, -1)}A.${signature}`
  expect(() => verifyEnvelope(tampered, publicKey)).toThrow(BridgeError)
})

it("bootstrap ticket TTL cannot exceed 60 seconds", () => {
  expect(() => buildBootstrapClaims({
    iss: "atlas", aud: "service", sub: "user-1", tenantId: "atlas",
    hostSessionId: "session", policyVersion: "policy-1", origin: "http://127.0.0.1:9001",
    jti: "ticket-1", iat: 100, exp: 161,
  })).toThrow(/at most 60 seconds/)
})

it("strict claims reject missing timestamps, unknown typ, and extra fields", () => {
  const valid = readClaims("medusa.products.retrieve", { productId: "prod_1" })
  const { exp: _exp, ...missingExp } = valid
  expect(() => parseDelegationClaims(missingExp)).toThrow(/missing or unknown/)
  expect(() => parseDelegationClaims({ ...valid, typ: "changedesk.future" })).toThrow(/Unknown delegation type/)
  expect(() => parseDelegationClaims({ ...valid, surprise: true })).toThrow(/missing or unknown/)
})

it("strict effect claims require the lease identity", () => {
  const valid = effectClaims({ productId: "prod_1", categoryId: "pcat_1" })
  expect(parseDelegationClaims(valid)).toEqual(valid)
  const { leaseOwner: _leaseOwner, ...missingLeaseOwner } = valid
  expect(() => parseDelegationClaims(missingLeaseOwner)).toThrow(/missing or unknown/)
})

it("closed command parser rejects remove and batch effects", () => {
  expect(() => parseCommand({
    capability: "medusa.product_categories.products.add",
    args: { productId: "prod_1", categoryId: "pcat_1", remove: ["prod_2"] },
  })).toThrow(/missing or unknown/)
  expect(() => parseCommand({
    capability: "medusa.product_categories.products.add",
    args: { productId: ["prod_1", "prod_2"], categoryId: "pcat_1" },
  })).toThrow(/bounded identifier/)
})

it("read delegation cannot authorize an effect", () => {
  const command = parseCommand({
    capability: "medusa.product_categories.products.add",
    args: { productId: "prod_1", categoryId: "pcat_1" },
  })
  expect(() => authorizeDelegation(readClaims(command.capability, command.args), command, actor, expected)).toThrow(/Read delegation/)
})

it("effect is bound to exact args and current role/session/policy", () => {
  const command = parseCommand({
    capability: "medusa.product_categories.products.add",
    args: { productId: "prod_1", categoryId: "pcat_1" },
  })
  authorizeDelegation(effectClaims(command.args), command, actor, expected)
  expect(() => authorizeDelegation(effectClaims({ productId: "prod_2", categoryId: "pcat_1" }), command, actor, expected)).toThrow(/does not authorize/)
  expect(() => authorizeDelegation(effectClaims(command.args), command, { ...actor, role: "viewer" }, expected)).toThrow(/cannot execute/)
  expect(() => authorizeDelegation(effectClaims(command.args), command, { ...actor, hostSessionId: "new-session" }, expected)).toThrow(/session or policy changed/)
})
})
