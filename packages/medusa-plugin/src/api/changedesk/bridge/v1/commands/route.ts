import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { readActorPolicy } from "../../../../../bridge/actor.ts"
import { executeEffect, executeRead, getProduct } from "../../../../../bridge/capabilities.ts"
import { BridgeError } from "../../../../../bridge/errors.ts"
import { verifyEnvelope } from "../../../../../bridge/crypto.ts"
import { authorizeDelegation, parseCommand } from "../../../../../bridge/validation.ts"
import type { DelegationClaims, EffectDelegationClaims, ReconcileDelegationClaims } from "../../../../../bridge/types.ts"
import { CHANGEDESK_MODULE } from "../../../../../modules/changedesk/index.ts"
import type ChangeDeskModuleService from "../../../../../modules/changedesk/service.ts"

const handle = async (req: MedusaRequest, res: MedusaResponse) => {
  const authorization = req.headers.authorization
  if (!authorization?.startsWith("ChangeDesk-Delegation ")) {
    throw new BridgeError(401, "delegation_required", "Signed delegation is required")
  }
  const service = req.scope.resolve(CHANGEDESK_MODULE) as ChangeDeskModuleService
  const claims = verifyEnvelope<DelegationClaims>(authorization.slice("ChangeDesk-Delegation ".length), service.getServicePublicKey())
  if (claims.typ === "changedesk.reconcile") {
    const body = req.body as Record<string, unknown>
    if (!body || Object.keys(body).length !== 1 || typeof body.operationKey !== "string" || body.operationKey !== claims.operationKey) {
      throw new BridgeError(400, "invalid_reconcile", "Reconcile body must contain the exact operationKey")
    }
    const options = service.getOptions()
    const now = Math.floor(Date.now() / 1000)
    if (claims.iss !== options.serviceIssuer || claims.aud !== options.installationId || claims.tenantId !== options.tenantId ||
        claims.exp <= now || claims.exp - claims.iat > 60 || claims.adapterVersion !== "medusa-2.22.1/changedesk-1") {
      throw new BridgeError(403, "delegation_mismatch", "Reconcile scope mismatch")
    }
    await service.consumeJti(claims.jti, claims.exp)
    const receipts = await service.listOperationReceipts({ tenant_id: claims.tenantId, operation_key: claims.operationKey })
    const receipt = receipts[0]
    if (!receipt || receipt.capability !== claims.capability || receipt.args_hash !== claims.argsHash ||
        receipt.semantic_input_hash !== claims.semanticInputHash || receipt.execution_id !== claims.executionId ||
        receipt.row_id !== claims.rowId || receipt.step_id !== claims.stepId) {
      throw new BridgeError(404, "receipt_not_found", "Receipt not found")
    }
    const product = await getProduct(req.scope as never, receipt.product_id)
    const postcondition = receipt.capability === "medusa.product_categories.products.add"
      ? product.categories?.some((item) => item.id === receipt.destination_id) === true
      : product.sales_channels?.some((item) => item.id === receipt.destination_id) === true
    const status = postcondition ? "confirmed" : receipt.status === "no_effect" ? "no_effect" : "unknown"
    res.setHeader("Cache-Control", "no-store")
    return res.status(200).json({ result: { status, postcondition } })
  }
  const command = parseCommand(req.body)
  const actor = await readActorPolicy(req.scope as never, claims.actorId)
  const options = service.getOptions()
  authorizeDelegation(claims, command, actor, {
    issuer: options.serviceIssuer,
    audience: options.installationId,
    tenantId: options.tenantId,
    now: Math.floor(Date.now() / 1000),
  })
  await service.consumeJti(claims.jti, claims.exp)
  if (claims.typ === "changedesk.effect") await service.assertCurrentAuthority(claims)

  const result = claims.typ === "changedesk.read"
    ? await executeRead(req.scope as never, command)
    : await executeEffect(req.scope as never, command, claims as EffectDelegationClaims)
  res.setHeader("Cache-Control", "no-store")
  return res.status(200).json({ result })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    return await handle(req, res)
  } catch (error) {
    if (!(error instanceof BridgeError)) throw error
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, requestId: req.headers["x-request-id"] ?? "host", retryable: error.status === 503 },
    })
  }
}
