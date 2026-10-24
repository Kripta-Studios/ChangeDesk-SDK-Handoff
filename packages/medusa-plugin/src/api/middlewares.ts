import { authenticate, defineMiddlewares, type MiddlewareVerb } from "@medusajs/framework/http"
import { denyManagedActorNativeMutation, denyNonLoginAuthMutation, revokeChangeDeskHostSession } from "../bridge/native-guard.ts"
import { storefrontLogoutMiddlewares } from "../storefront/logout-middleware.ts"

const MUTATING_METHODS: MiddlewareVerb[] = ["POST", "PUT", "PATCH", "DELETE"]

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/customers/me/changedesk/session",
      method: ["POST"],
      middlewares: [authenticate("customer", "session")],
    },
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
      // Keep the plugin guard explicit rather than relying on native middleware
      // ordering. The hook revokes staff metadata and lets customer logout
      // continue to Medusa's native session destroy handler.
      middlewares: storefrontLogoutMiddlewares(authenticate(["user", "customer"], ["session"]), revokeChangeDeskHostSession),
    },
    {
      matcher: /^\/auth(?:\/.*)?$/,
      method: MUTATING_METHODS,
      middlewares: [denyNonLoginAuthMutation],
    },
  ],
})
