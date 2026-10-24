import { sha256ProtectedState, sha256StepPrecondition } from "./crypto.ts"

export type ProtectedProduct = {
  id: string
  title?: string
  handle?: string
  description?: string | null
  status: string
  metadata?: Record<string, unknown> | null
  tags?: { id: string }[]
  variants?: Array<{
    id: string
    sku?: string | null
    manage_inventory?: boolean
    prices?: Array<{ id?: string; amount: number; currency_code: string }>
  }>
  categories?: { id: string }[]
  sales_channels?: { id: string }[]
}

export const protectedProductFingerprint = (product: ProtectedProduct) => sha256ProtectedState({
  id: product.id,
  title: product.title ?? null,
  handle: product.handle ?? null,
  description: product.description ?? null,
  status: product.status,
  metadata: product.metadata ?? null,
  tags: (product.tags ?? []).map(({ id }) => ({ id })).sort((a, b) => a.id.localeCompare(b.id)),
  variants: (product.variants ?? []).map((variant) => ({
    id: variant.id,
    sku: variant.sku ?? null,
    manage_inventory: variant.manage_inventory ?? false,
    prices: (variant.prices ?? []).map((price) => ({
      id: price.id ?? null,
      amount: price.amount,
      currency_code: price.currency_code,
    })).sort((a, b) => `${a.currency_code}:${a.id}`.localeCompare(`${b.currency_code}:${b.id}`)),
  })).sort((a, b) => a.id.localeCompare(b.id)),
})

export type StepPrecondition = {
  protectedDigest: string
  categoryIds: string[]
  channelIds: string[]
}

export const stepPreconditionFingerprint = (input: StepPrecondition) => sha256StepPrecondition({
  protectedDigest: input.protectedDigest,
  categoryIds: [...new Set(input.categoryIds)].sort(),
  channelIds: [...new Set(input.channelIds)].sort(),
})

export const productStepPreconditionFingerprint = (product: ProtectedProduct) =>
  stepPreconditionFingerprint({
    protectedDigest: protectedProductFingerprint(product),
    categoryIds: (product.categories ?? []).map(({ id }) => id),
    channelIds: (product.sales_channels ?? []).map(({ id }) => id),
  })
