import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { timingSafeEqual } from "node:crypto";
import { BridgeError } from "../../../../../../../bridge/errors.ts";
import { CHANGEDESK_MODULE } from "../../../../../../../modules/changedesk/index.ts";
import type ChangeDeskModuleService from "../../../../../../../modules/changedesk/service.ts";
import { storefrontSessionRegistry, type ExpressSessionStoreLike } from "../../../../../../../storefront/session-registry.ts";

const equal = (actual: string, expected: string) => { const left = Buffer.from(actual); const right = Buffer.from(expected); return left.length === right.length && timingSafeEqual(left, right); };
const handle = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve(CHANGEDESK_MODULE) as ChangeDeskModuleService;
  const options = service.getOptions();
  if (!equal(req.headers.authorization ?? "", `Bearer ${options.authorityCredential}`)) throw new BridgeError(401, "service_auth_required", "Service authentication is required");
  const body = req.body as Record<string, unknown>;
  if (!body || Object.keys(body).sort().join(",") !== "buyerId,hostSessionId,policyVersion" || typeof body.buyerId !== "string" || typeof body.hostSessionId !== "string" || body.policyVersion !== "storefront-buyer-v1") throw new BridgeError(400, "invalid_reauthorize", "Exact buyer session binding is required");
  const sessionStore = (req as MedusaRequest & { sessionStore?: ExpressSessionStoreLike }).sessionStore;
  const active = !!sessionStore && await storefrontSessionRegistry.authorize({ tenantId: options.tenantId, buyerId: body.buyerId, hostSessionId: body.hostSessionId, store: sessionStore });
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ active, policyVersion: active ? "storefront-buyer-v1" : null });
};

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try { return await handle(req, res); }
  catch (error) {
    if (!(error instanceof BridgeError)) throw error;
    return res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: req.headers["x-request-id"] ?? "host", retryable: false } });
  }
};
