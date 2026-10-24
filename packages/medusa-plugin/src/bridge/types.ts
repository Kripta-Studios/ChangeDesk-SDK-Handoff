export const CAPABILITY_IDS = [
  "medusa.products.list",
  "medusa.products.retrieve",
  "medusa.product_categories.retrieve",
  "medusa.sales_channels.retrieve",
  "medusa.product_categories.products.add",
  "medusa.sales_channels.products.add",
] as const

export type CapabilityId = (typeof CAPABILITY_IDS)[number]

export const READ_CAPABILITIES = CAPABILITY_IDS.slice(0, 4) as readonly CapabilityId[]
export const EFFECT_CAPABILITIES = CAPABILITY_IDS.slice(4) as readonly CapabilityId[]

export type ProductListArgs = {
  ids?: string[]
  limit: number
}

export type ProductRetrieveArgs = { productId: string }
export type CategoryRetrieveArgs = { categoryId: string }
export type ChannelRetrieveArgs = { channelId: string }
export type CategoryAddArgs = { productId: string; categoryId: string }
export type ChannelAddArgs = { productId: string; channelId: string }

export type CapabilityArgs = {
  "medusa.products.list": ProductListArgs
  "medusa.products.retrieve": ProductRetrieveArgs
  "medusa.product_categories.retrieve": CategoryRetrieveArgs
  "medusa.sales_channels.retrieve": ChannelRetrieveArgs
  "medusa.product_categories.products.add": CategoryAddArgs
  "medusa.sales_channels.products.add": ChannelAddArgs
}

export type BridgeCommand<C extends CapabilityId = CapabilityId> = {
  capability: C
  args: CapabilityArgs[C]
}

export type BootstrapClaims = {
  v: 1
  typ: "changedesk.bootstrap"
  iss: string
  aud: string
  sub: string
  tenantId: string
  hostSessionId: string
  policyVersion: string
  origin: string
  jti: string
  iat: number
  exp: number
}

type DelegationBase = {
  v: 1
  iss: string
  aud: string
  tenantId: string
  actorId: string
  hostSessionId: string
  policyVersion: string
  adapterVersion: "medusa-2.22.1/changedesk-1"
  capability: CapabilityId
  argsHash: string
  jti: string
  iat: number
  exp: number
}

export type ReadDelegationClaims = DelegationBase & {
  typ: "changedesk.read"
  requestId: string
}

export type EffectDelegationClaims = DelegationBase & {
  typ: "changedesk.effect"
  executionId: string
  rowId: string
  stepId: string
  planId: string
  planHash: string
  planVersion: number
  approvalId: string
  approvalExpiresAt: number
  semanticInputHash: string
  operationKey: string
  fence: number
  preconditions: {
    productStatus: "published"
    productUnlocked: true
    relationAbsent: true
    preconditionFingerprint: string
  }
}

export type ReconcileDelegationClaims = {
  v: 1
  typ: "changedesk.reconcile"
  iss: string
  aud: string
  tenantId: string
  adapterVersion: "medusa-2.22.1/changedesk-1"
  executionId: string
  rowId: string
  stepId: string
  operationKey: string
  capability: CapabilityId
  argsHash: string
  semanticInputHash: string
  jti: string
  iat: number
  exp: number
}

export type DelegationClaims = ReadDelegationClaims | EffectDelegationClaims | ReconcileDelegationClaims

export type ActorPolicy = {
  managed: boolean
  active: boolean
  role: "viewer" | "requester" | "operator" | "admin"
  policyVersion: string
  hostSessionId: string
  readableProductIds: string[]
}

export type BridgeReceipt = {
  operationKey: string
  capability: CapabilityId
  argsHash: string
  semanticInputHash: string
  fence: number
  status: "intent_recorded" | "sent" | "confirmed" | "no_effect" | "rejected" | "unknown"
  readback?: unknown
}
