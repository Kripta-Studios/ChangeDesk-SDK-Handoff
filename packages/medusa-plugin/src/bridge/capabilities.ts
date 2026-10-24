import { batchLinkProductsToCategoryWorkflow, linkProductsToSalesChannelWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BridgeError } from "./errors.ts"
import type { BridgeCommand, EffectDelegationClaims } from "./types.ts"
import { CHANGEDESK_MODULE } from "../modules/changedesk/index.ts"
import type ChangeDeskModuleService from "../modules/changedesk/service.ts"

type Query = { graph(input: unknown, options?: unknown): Promise<{ data: unknown[]; metadata?: unknown }> }
type Scope = { resolve(name: string): unknown }

const productFields = [
  "id", "title", "handle", "status", "metadata", "categories.id", "sales_channels.id",
  "tags.id", "variants.id", "variants.sku", "variants.manage_inventory",
  "variants.prices.id", "variants.prices.amount", "variants.prices.currency_code",
]

const graph = async (scope: Scope, entity: string, fields: string[], filters: object) => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as Query
  return query.graph({ entity, fields, filters }, { throwIfKeyNotFound: true })
}

export const getProduct = async (scope: Scope, productId: string) => {
  const { data } = await graph(scope, "product", productFields, { id: productId })
  if (!data[0]) throw new BridgeError(404, "resource_not_found", "Resource not found")
  return data[0] as {
    id: string
    status: string
    metadata?: { changedesk_locked?: boolean }
    categories?: { id: string }[]
    sales_channels?: { id: string }[]
  }
}

export const relationPresent = (product: Awaited<ReturnType<typeof getProduct>>, command: BridgeCommand) => {
  if (command.capability === "medusa.product_categories.products.add") {
    return product.categories?.some((category) => category.id === command.args.categoryId) ?? false
  }
  if (command.capability === "medusa.sales_channels.products.add") {
    return product.sales_channels?.some((channel) => channel.id === command.args.channelId) ?? false
  }
  return false
}

export const executeRead = async (scope: Scope, command: BridgeCommand) => {
  switch (command.capability) {
    case "medusa.products.list": {
      const query = scope.resolve(ContainerRegistrationKeys.QUERY) as Query
      const { data, metadata } = await query.graph({
        entity: "product",
        fields: productFields,
        filters: command.args.ids ? { id: command.args.ids } : {},
        pagination: { take: command.args.limit, skip: 0 },
      })
      return { products: data, metadata }
    }
    case "medusa.products.retrieve":
      return { product: await getProduct(scope, command.args.productId) }
    case "medusa.product_categories.retrieve": {
      const service = scope.resolve(CHANGEDESK_MODULE) as ChangeDeskModuleService
      if (!service.isAllowedDestination(command.capability, command.args.categoryId)) {
        throw new BridgeError(404, "resource_not_found", "Resource not found")
      }
      const { data } = await graph(scope, "product_category", ["id", "name", "handle", "is_active"], { id: command.args.categoryId })
      if (!data[0]) throw new BridgeError(404, "resource_not_found", "Resource not found")
      return { productCategory: data[0] }
    }
    case "medusa.sales_channels.retrieve": {
      const service = scope.resolve(CHANGEDESK_MODULE) as ChangeDeskModuleService
      if (!service.isAllowedDestination(command.capability, command.args.channelId)) {
        throw new BridgeError(404, "resource_not_found", "Resource not found")
      }
      const { data } = await graph(scope, "sales_channel", ["id", "name", "is_disabled"], { id: command.args.channelId })
      if (!data[0]) throw new BridgeError(404, "resource_not_found", "Resource not found")
      return { salesChannel: data[0] }
    }
    default:
      throw new BridgeError(403, "read_only", "Effect capability requires effect delegation")
  }
}

export const executeEffect = async (scope: Scope, command: BridgeCommand, claims: EffectDelegationClaims) => {
  if (command.capability !== "medusa.product_categories.products.add" && command.capability !== "medusa.sales_channels.products.add") {
    throw new BridgeError(400, "effect_required", "Unsupported effect command")
  }
  const service = scope.resolve(CHANGEDESK_MODULE) as ChangeDeskModuleService
  const productId = command.args.productId
  const destinationId = command.capability === "medusa.product_categories.products.add" ? command.args.categoryId : command.args.channelId
  if (!service.isAllowedDestination(command.capability, destinationId)) {
    throw new BridgeError(404, "resource_not_found", "Resource not found")
  }

  return service.withResourceLock("catalog-mutator", async () => service.withResourceLock(`product:${productId}`, async () => {
    const existing = await service.listOperationReceipts({ tenant_id: claims.tenantId, operation_key: claims.operationKey })
    const receipt = existing[0]
    if (receipt) {
      if (receipt.capability !== command.capability || receipt.args_hash !== claims.argsHash ||
          receipt.semantic_input_hash !== claims.semanticInputHash || receipt.fence !== claims.fence ||
          receipt.execution_id !== claims.executionId || receipt.row_id !== claims.rowId || receipt.step_id !== claims.stepId) {
        throw new BridgeError(409, "operation_key_collision", "Operation key is already bound")
      }
      if (receipt.status === "confirmed" || receipt.status === "no_effect") return receipt
      const observed = await getProduct(scope, productId)
      if (relationPresent(observed, command)) {
        return service.updateOperationReceipts({ id: receipt.id, status: "confirmed", readback: observed })
      }
    }

    const before = await getProduct(scope, productId)
    if (before.status !== "published" || before.metadata?.changedesk_locked === true) {
      throw new BridgeError(409, "precondition_failed", "Product is no longer eligible")
    }
    if (relationPresent(before, command)) {
      return receipt ?? service.createOperationReceipts({
        tenant_id: claims.tenantId, operation_key: claims.operationKey, actor_id: claims.actorId,
        execution_id: claims.executionId, row_id: claims.rowId, step_id: claims.stepId,
        product_id: productId, destination_id: destinationId,
        capability: command.capability, args_hash: claims.argsHash,
        semantic_input_hash: claims.semanticInputHash, fence: claims.fence,
        status: "no_effect", readback: before,
      })
    }

    const intent = receipt ?? await service.createOperationReceipts({
      tenant_id: claims.tenantId, operation_key: claims.operationKey, actor_id: claims.actorId,
      execution_id: claims.executionId, row_id: claims.rowId, step_id: claims.stepId,
      product_id: productId, destination_id: destinationId,
      capability: command.capability, args_hash: claims.argsHash,
      semantic_input_hash: claims.semanticInputHash, fence: claims.fence, status: "intent_recorded",
    })
    await service.updateOperationReceipts({ id: intent.id, status: "sent" })
    if (command.capability === "medusa.product_categories.products.add") {
      await batchLinkProductsToCategoryWorkflow(scope as never).run({ input: { id: command.args.categoryId, add: [productId], remove: [] } })
    } else {
      await linkProductsToSalesChannelWorkflow(scope as never).run({ input: { id: command.args.channelId, add: [productId], remove: [] } })
    }
    const after = await getProduct(scope, productId)
    if (!relationPresent(after, command)) {
      await service.updateOperationReceipts({ id: intent.id, status: "unknown", readback: after })
      throw new BridgeError(503, "readback_failed", "Effect could not be confirmed")
    }
    return service.updateOperationReceipts({ id: intent.id, status: "confirmed", readback: after })
  }))
}
