import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createHash } from "node:crypto"
import { updateUsersWorkflow } from "@medusajs/core-flows"
import { BridgeError } from "../../../../bridge/errors.ts"
import { readActorPolicy } from "../../../../bridge/actor.ts"
import { CHANGEDESK_MODULE } from "../../../../modules/changedesk/index.ts"
import type ChangeDeskModuleService from "../../../../modules/changedesk/service.ts"

const hashSessionId = (sessionId: string) =>
  createHash("sha256").update("changedesk-host-session-v1\0").update(sessionId).digest("hex")

const handle = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  if (req.body && Object.keys(req.body as object).length !== 0) {
    throw new BridgeError(400, "body_forbidden", "Actor and tenant are derived from the host session")
  }
  const origin = req.headers.origin
  if (!origin || req.headers["x-changedesk-csrf"] !== "1") {
    throw new BridgeError(403, "csrf_rejected", "Exact Origin and CSRF header are required")
  }
  if (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") {
    throw new BridgeError(403, "csrf_rejected", "Cross-site session bootstrap is forbidden")
  }
  const actorId = req.auth_context?.actor_id
  const sessionId = (req as AuthenticatedMedusaRequest & { sessionID?: string }).sessionID
  if (!actorId || !sessionId || !req.session?.auth_context) {
    throw new BridgeError(401, "host_session_required", "A Medusa cookie session is required")
  }
  const service = req.scope.resolve(CHANGEDESK_MODULE) as ChangeDeskModuleService
  const release = await service.acquireResourceLocks(["authority-mutator"])
  try {
    const policy = await readActorPolicy(req.scope as never, actorId)
    const hostSessionId = hashSessionId(sessionId)
    await updateUsersWorkflow(req.scope).run({
      input: {
        updates: [{ id: actorId, metadata: { changedesk: { ...policy, hostSessionId } } }],
      },
    })
    const { ticket, claims } = service.issueBootstrapTicket({
      actorId,
      hostSessionId,
      policyVersion: policy.policyVersion,
      origin,
      now: Math.floor(Date.now() / 1000),
    })
    res.setHeader("Cache-Control", "no-store")
    return res.status(200).json({ ticket, expiresAt: new Date(claims.exp * 1000).toISOString() })
  } finally {
    release()
  }
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    return await handle(req, res)
  } catch (error) {
    if (!(error instanceof BridgeError)) throw error
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, requestId: req.headers["x-request-id"] ?? "host", retryable: false },
    })
  }
}
