import type { KeyObject } from "node:crypto";

export interface StorefrontTicketClaims {
  readonly v: 1; readonly typ: "changedesk.storefront.bootstrap"; readonly iss: string; readonly aud: string;
  readonly sub: string; readonly tenantId: string; readonly hostSessionId: string; readonly policyVersion: string;
  readonly origin: string; readonly jti: string; readonly iat: number; readonly exp: number;
}
export const storefrontAudience = (serviceAudience: string) => `${serviceAudience}:storefront`;
export const storefrontSessionBinding = (_tenantId: string, _buyerId: string, _hostSessionId: string) => "not-implemented";
export const hashStorefrontHostSession = (_credential: string) => "not-implemented";
export function issueStorefrontBootstrapTicket(_input: { issuer: string; serviceAudience: string; tenantId: string; buyerId: string; hostSessionId: string; origin: string; now: number; privateKey: KeyObject; jti?: string }): { ticket: string; claims: StorefrontTicketClaims } { throw new Error("not-implemented"); }
