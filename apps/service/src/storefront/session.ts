import { createHash, randomBytes, verify, type KeyObject } from "node:crypto";
import { forbidden, unauthorized } from "../api/errors.js";
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
  readonly #sessions = new Map<string, BuyerContext & { issuer: string }>();
  constructor(private readonly replay: StorefrontTicketReplayStore, private readonly host: BuyerHostIdentityPort, private readonly options: { audience: string; issuers: readonly string[]; origins: readonly string[]; ticketMaxTtlSeconds: number; sessionTtlSeconds: number; clock?: () => Date }) {}

  async exchange(ticket: string, origin: string): Promise<{ accessToken: string; expiresAt: string }> {
    const now = Math.floor((this.options.clock?.() ?? new Date()).getTime() / 1000);
    const [payloadPart, signaturePart, extra] = ticket.split(".");
    if (!payloadPart || !signaturePart || extra) throw unauthorized();
    let claims: StorefrontBootstrapClaims;
    try { claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as StorefrontBootstrapClaims; } catch { throw unauthorized(); }
    if (!validClaims(claims) || claims.v !== 1 || claims.typ !== "changedesk.storefront.bootstrap" || claims.aud !== this.options.audience || !this.options.issuers.includes(claims.iss)) throw unauthorized();
    if (claims.origin !== origin || !this.options.origins.includes(origin)) throw forbidden();
    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp <= now || claims.iat > now + 5 || claims.exp - claims.iat > this.options.ticketMaxTtlSeconds) throw unauthorized();
    const payload = Buffer.from(payloadPart, "base64url");
    const key = await this.host.publicKey(claims.iss);
    if (!verify(null, payload, key, Buffer.from(signaturePart, "base64url"))) throw unauthorized();
    if (!await this.replay.consumeTicket({ tenantId: claims.tenantId, buyerId: claims.sub, ticketId: hash(ticket), issuer: claims.iss, jti: claims.jti, audience: claims.aud, expiresAt: new Date(claims.exp * 1000) })) throw unauthorized();
    const current = await this.host.reauthorizeBuyer({ issuer: claims.iss, tenantId: claims.tenantId, buyerId: claims.sub, hostSessionId: claims.hostSessionId, policyVersion: claims.policyVersion });
    if (!current.active || current.policyVersion !== claims.policyVersion) throw unauthorized();
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now * 1000 + this.options.sessionTtlSeconds * 1000).toISOString();
    this.#sessions.set(hash(accessToken), { kind: "buyer", issuer: claims.iss, tenantId: claims.tenantId, buyerId: claims.sub, hostSessionId: claims.hostSessionId, policyVersion: current.policyVersion, expiresAt });
    return { accessToken, expiresAt };
  }

  async authenticate(authorization: string | undefined): Promise<BuyerContext> {
    const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(authorization ?? "");
    if (!match) throw unauthorized();
    const tokenHash = hash(match[1]!); const session = this.#sessions.get(tokenHash);
    const now = (this.options.clock?.() ?? new Date()).getTime();
    if (!session || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now) { this.#sessions.delete(tokenHash); throw unauthorized(); }
    const current = await this.host.reauthorizeBuyer({ issuer: session.issuer, tenantId: session.tenantId, buyerId: session.buyerId, hostSessionId: session.hostSessionId, policyVersion: session.policyVersion });
    if (!current.active || current.policyVersion !== session.policyVersion) { this.#sessions.delete(tokenHash); throw unauthorized(); }
    const { issuer: _issuer, ...context } = session; return context;
  }
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function validClaims(value: StorefrontBootstrapClaims): boolean {
  return typeof value === "object" && value !== null && [value.iss, value.aud, value.sub, value.tenantId, value.hostSessionId, value.policyVersion, value.origin, value.jti].every((item) => typeof item === "string" && item.length > 0);
}
