import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { BridgeError } from "../../../../../../../bridge/errors.ts";
import { importPrivateKey } from "../../../../../../../bridge/crypto.ts";
import { CHANGEDESK_MODULE } from "../../../../../../../modules/changedesk/index.ts";
import type ChangeDeskModuleService from "../../../../../../../modules/changedesk/service.ts";
import { issueStorefrontBootstrapTicket } from "../../../../../../../storefront/ticket.ts";
import { storefrontSessionRegistry } from "../../../../../../../storefront/session-registry.ts";

const handle = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  if (req.body && Object.keys(req.body as object).length !== 0) throw new BridgeError(400, "body_forbidden", "Buyer identity is derived from Medusa authentication");
  const origin = req.headers.origin;
  const buyerId = req.auth_context?.actor_id;
  const actorType = req.auth_context?.actor_type;
  const sessionId = (req as AuthenticatedMedusaRequest & { sessionID?: string }).sessionID;
  if (req.headers.authorization) throw new BridgeError(400, "bearer_lifecycle_unsupported", "Storefront bootstrap v1 requires a cookie session");
  if (actorType !== "customer" || !buyerId || !sessionId || !req.session?.auth_context) throw new BridgeError(401, "customer_session_required", "A current Medusa cookie session is required");
  const service = req.scope.resolve(CHANGEDESK_MODULE) as ChangeDeskModuleService;
  const options = service.getOptions();
  if (!origin || !options.allowedOrigins.includes(origin)) throw new BridgeError(403, "origin_forbidden", "Exact storefront Origin is required");
  if (!req.headers.authorization && req.headers["x-changedesk-csrf"] !== "1") throw new BridgeError(403, "csrf_rejected", "Cookie sessions require the CSRF header");
  const now = Math.floor(Date.now() / 1000);
  const cookieExpiry = Date.parse(String(req.session.cookie?.expires));
  const expiresAt = Math.min(Number.isFinite(cookieExpiry) ? cookieExpiry : (now + 360) * 1000, (now + 360) * 1000);
  const hostSessionId = storefrontSessionRegistry.register({ tenantId: options.tenantId, buyerId, rawSessionId: sessionId, expiresAt });
  const result = issueStorefrontBootstrapTicket({ issuer: options.installationId, serviceAudience: options.serviceAudience, tenantId: options.tenantId, buyerId, hostSessionId, origin, now, privateKey: importPrivateKey(options.bootstrapPrivateKeyPem) });
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ticket: result.ticket, expiresAt: new Date(result.claims.exp * 1000).toISOString() });
};

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try { return await handle(req, res); }
  catch (error) {
    if (!(error instanceof BridgeError)) throw error;
    return res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: req.headers["x-request-id"] ?? "host", retryable: false } });
  }
};
