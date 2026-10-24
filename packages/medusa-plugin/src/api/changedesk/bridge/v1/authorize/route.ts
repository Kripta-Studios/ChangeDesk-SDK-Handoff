import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { timingSafeEqual } from "node:crypto"
import { BridgeError } from "../../../../../bridge/errors.ts"
import { CHANGEDESK_MODULE } from "../../../../../modules/changedesk/index.ts"
import type ChangeDeskModuleService from "../../../../../modules/changedesk/service.ts"

const equalCredential = (actual: string, expected: string) => {
  const left = Buffer.from(actual, "utf8")
  const right = Buffer.from(expected, "utf8")
  return left.length === right.length && timingSafeEqual(left, right)
}

const handle = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve(CHANGEDESK_MODULE) as ChangeDeskModuleService
  const expected = `Bearer ${service.getOptions().authorityCredential}`
  if (!equalCredential(req.headers.authorization ?? "", expected)) {
    throw new BridgeError(401, "service_auth_required", "Service authentication is required")
  }
  const body = req.body as Record<string, unknown>
  if (!body || Object.keys(body).sort().join(",") !== "actorId,hostSessionId,policyVersion" ||
      typeof body.actorId !== "string" || typeof body.hostSessionId !== "string" || typeof body.policyVersion !== "string") {
    throw new BridgeError(400, "invalid_reauthorize", "Exact actor session and policy binding is required")
  }
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "user", fields: ["id", "metadata"], filters: { id: body.actorId } })
  const policy = (data[0] as { metadata?: { changedesk?: Record<string, unknown> } } | undefined)?.metadata?.changedesk
  const role = policy?.role
  const active = policy?.managed === true && policy?.active === true &&
    policy?.hostSessionId === body.hostSessionId && policy?.policyVersion === body.policyVersion &&
    ["viewer", "requester", "operator", "admin"].includes(String(role))
  res.setHeader("Cache-Control", "no-store")
  return res.status(200).json({ active, roles: active ? [role] : [], policyVersion: active ? policy!.policyVersion : null })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    return await handle(req, res)
  } catch (error) {
    if (!(error instanceof BridgeError)) throw error
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, requestId: req.headers["x-request-id"] ?? "host", retryable: false },
    })
  }
}
