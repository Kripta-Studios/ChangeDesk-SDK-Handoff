import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BridgeError } from "./errors.ts"
import type { ActorPolicy } from "./types.ts"

type Scope = { resolve(name: string): { graph(input: unknown, options?: unknown): Promise<{ data: unknown[] }> } }

export const readActorPolicy = async (scope: Scope, actorId: string): Promise<ActorPolicy> => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph(
    {
      entity: "user",
      fields: ["id", "metadata"],
      filters: { id: actorId },
    },
    { throwIfKeyNotFound: true }
  )
  const user = data[0] as { metadata?: { changedesk?: Partial<ActorPolicy> } } | undefined
  const policy = user?.metadata?.changedesk
  if (
    !policy ||
    policy.managed !== true ||
    policy.active !== true ||
    !["viewer", "requester", "operator", "admin"].includes(String(policy.role)) ||
    typeof policy.policyVersion !== "string" ||
    typeof policy.hostSessionId !== "string"
  ) {
    throw new BridgeError(403, "actor_policy_missing", "Actor does not have an active Change Desk policy")
  }
  return policy as ActorPolicy
}
