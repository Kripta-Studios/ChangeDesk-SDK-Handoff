import { createHash, type KeyObject } from "node:crypto";
import { newJti, signEnvelope } from "../bridge/crypto.ts";

export interface StorefrontTicketClaims {
  readonly v: 1; readonly typ: "changedesk.storefront.bootstrap"; readonly iss: string; readonly aud: string;
  readonly sub: string; readonly tenantId: string; readonly hostSessionId: string; readonly policyVersion: string;
  readonly origin: string; readonly jti: string; readonly iat: number; readonly exp: number;
}
export const storefrontAudience = (serviceAudience: string) => `${serviceAudience}:storefront`;
export const storefrontSessionBinding = (tenantId: string, buyerId: string, hostSessionId: string) => createHash("sha256").update("changedesk-storefront-session-binding-v1\0").update(tenantId).update("\0").update(buyerId).update("\0").update(hostSessionId).digest("hex");
export const hashStorefrontHostSession = (credential: string) => createHash("sha256").update("changedesk-storefront-host-session-v1\0").update(credential).digest("hex");
export function issueStorefrontBootstrapTicket(input: { issuer: string; serviceAudience: string; tenantId: string; buyerId: string; hostSessionId: string; origin: string; now: number; privateKey: KeyObject; jti?: string }): { ticket: string; claims: StorefrontTicketClaims } {
  const claims: StorefrontTicketClaims = { v: 1, typ: "changedesk.storefront.bootstrap", iss: input.issuer, aud: storefrontAudience(input.serviceAudience), sub: input.buyerId, tenantId: input.tenantId, hostSessionId: input.hostSessionId, policyVersion: "storefront-buyer-v1", origin: input.origin, jti: input.jti ?? newJti(), iat: input.now, exp: input.now + 60 };
  return { ticket: signEnvelope(claims, input.privateKey), claims };
}
