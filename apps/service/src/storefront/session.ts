import type { KeyObject } from "node:crypto";
import type { BuyerContext } from "./types.js";

export interface StorefrontBootstrapClaims {
  readonly v: 1;
  readonly typ: "changedesk.storefront.bootstrap";
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly tenantId: string;
  readonly hostSessionId: string;
  readonly policyVersion: string;
  readonly origin: string;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
}
export interface StorefrontTicketReplayStore { consumeTicket(input: { tenantId: string; buyerId: string; ticketId: string; issuer: string; jti: string; audience: string; expiresAt: Date }): Promise<boolean>; }
export interface BuyerHostIdentityPort {
  publicKey(issuer: string): Promise<KeyObject>;
  reauthorizeBuyer(input: { issuer: string; tenantId: string; buyerId: string; hostSessionId: string; policyVersion: string }): Promise<{ active: boolean; policyVersion: string }>;
}

export class BuyerSessionManager {
  constructor(_replay: StorefrontTicketReplayStore, _host: BuyerHostIdentityPort, _options: { audience: string; issuers: readonly string[]; origins: readonly string[]; ticketMaxTtlSeconds: number; sessionTtlSeconds: number; clock?: () => Date }) {}
  async exchange(_ticket: string, _origin: string): Promise<{ accessToken: string; expiresAt: string }> { throw new Error("buyer_session_not_implemented"); }
  async authenticate(_authorization: string | undefined): Promise<BuyerContext> { throw new Error("buyer_session_not_implemented"); }
}
