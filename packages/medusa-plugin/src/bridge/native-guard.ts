import type { AuthenticatedMedusaRequest, MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { mustDenyAdminMutation, mustDenyAuthMutation } from "./native-policy.ts"
import { CHANGEDESK_MODULE } from "../modules/changedesk/index.ts"
import type ChangeDeskModuleService from "../modules/changedesk/service.ts"
import { readActorPolicy } from "./actor.ts"
import { updateUsersWorkflow } from "@medusajs/core-flows"

export const denyNonLoginAuthMutation = (
  req: AuthenticatedMedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) => {
  if (!mustDenyAuthMutation(req.path)) return next()
  return next(new MedusaError(MedusaError.Types.FORBIDDEN, "Authentication mutation disabled in the demo lab"))
}

export const denyManagedActorNativeMutation = async (
  req: AuthenticatedMedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) => {
  if (!mustDenyAdminMutation(req.path, true)) return next()
  const actorId = req.auth_context?.actor_id
  if (!actorId) return next(new MedusaError(MedusaError.Types.UNAUTHORIZED, "An actor-bound session is required"))
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "user",
    fields: ["id", "metadata"],
    filters: { id: actorId },
  })
  const user = data[0] as { metadata?: { changedesk?: { managed?: boolean } } } | undefined
  if (mustDenyAdminMutation(req.path, user?.metadata?.changedesk?.managed === true)) {
    return next(new MedusaError(MedusaError.Types.FORBIDDEN, "Managed Change Desk demo actors cannot use native mutation routes"))
  }
  if (/^\/admin\/(?:products|product-categories|sales-channels)(?:\/|$)/.test(req.path)) {
    const service = req.scope.resolve(CHANGEDESK_MODULE) as ChangeDeskModuleService
    const release = await service.acquireResourceLocks(["catalog-mutator"])
    let released = false
    const releaseOnce = () => {
      if (!released) {
        released = true
        release()
      }
    }
    _res.once("finish", releaseOnce)
    _res.once("close", releaseOnce)
  }
  return next()
}

export const revokeChangeDeskHostSession = async (
  req: AuthenticatedMedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) => {
  const actorId = req.auth_context?.actor_id
  if (!actorId) return next(new MedusaError(MedusaError.Types.UNAUTHORIZED, "A session is required"))
  const policy = await readActorPolicy(req.scope as never, actorId)
  await updateUsersWorkflow(req.scope).run({
    input: {
      updates: [{
        id: actorId,
        metadata: {
          changedesk: { ...policy, hostSessionId: `revoked:${Date.now()}` },
        },
      }],
    },
  })
  return next()
}
