import { authenticate, defineMiddlewares } from "@medusajs/framework/http"
import { denyManagedActorNativeMutation, denyNonLoginAuthMutation, revokeChangeDeskHostSession } from "../bridge/native-guard.ts"

const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"]

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/changedesk/session",
      method: ["POST"],
      middlewares: [authenticate("user", "session")],
    },
    {
      matcher: /^\/admin(?:\/.*)?$/,
      method: MUTATING_METHODS,
      middlewares: [authenticate("user", ["session", "bearer", "api-key"]), denyManagedActorNativeMutation],
    },
    {
      matcher: "/auth/session",
      method: ["DELETE"],
      middlewares: [authenticate("user", "session"), revokeChangeDeskHostSession],
    },
    {
      matcher: /^\/auth(?:\/.*)?$/,
      method: MUTATING_METHODS,
      middlewares: [denyNonLoginAuthMutation],
    },
  ],
})
