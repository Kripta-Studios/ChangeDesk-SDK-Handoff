import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BuyerContext, StorefrontAdminContext, StorefrontRepository } from "./types.js";

export interface StorefrontRouteDependencies {
  readonly repository: StorefrontRepository;
  readonly authenticateBuyer: (request: FastifyRequest) => Promise<BuyerContext | null>;
  readonly authenticateAdmin: (request: FastifyRequest) => Promise<StorefrontAdminContext | null>;
  readonly now?: () => Date;
  readonly requestId?: () => string;
}

/** Explicit opt-in route registration. No routes are registered by importing this module. */
export async function registerStorefrontRoutes(app: FastifyInstance, _dependencies: StorefrontRouteDependencies): Promise<void> {
  const unavailable = async (_request: FastifyRequest, reply: { code(status: number): unknown }) => {
    reply.code(501);
    return { error: { code: "not_implemented", message: "Storefront route not implemented", requestId: "red", retryable: false } };
  };
  app.get("/v1/storefront/me/preferences", unavailable);
  app.put("/v1/storefront/me/preferences", unavailable);
  app.post("/v1/storefront/global-change-proposals", unavailable);
  app.get("/v1/storefront/global-change-proposals/:id", unavailable);
  app.get("/v1/storefront/admin/global-change-proposals", unavailable);
  app.get("/v1/storefront/admin/global-change-proposals/:id", unavailable);
  app.post("/v1/storefront/admin/global-change-proposals/:id/approve", unavailable);
  app.post("/v1/storefront/admin/global-change-proposals/:id/reject", unavailable);
}
