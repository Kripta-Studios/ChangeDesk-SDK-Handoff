import { createHash, randomBytes, verify, type KeyObject } from "node:crypto";
import { ApiError, forbidden, unauthorized } from "../api/errors.js";
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
  readonly #maxSessions: number;
  #pendingExchanges = 0;
  constructor(private readonly replay: StorefrontTicketReplayStore, private readonly host: BuyerHostIdentityPort, private readonly options: { audience: string; issuers: readonly string[]; origins: readonly string[]; ticketMaxTtlSeconds: number; sessionTtlSeconds: number; maxSessions?: number; clock?: () => Date }) {
    const maxSessions = options.maxSessions ?? 10_000;
    if (!Number.isSafeInteger(maxSessions) || maxSessions <= 0) throw new RangeError("maxSessions must be a positive safe integer");
    this.#maxSessions = maxSessions;
  }

  async exchange(ticket: string, origin: string): Promise<{ accessToken: string; expiresAt: string }> {
    const currentTime = this.options.clock?.() ?? new Date();
    const now = Math.floor(currentTime.getTime() / 1000);
    this.purgeExpired(currentTime.getTime());
    if (this.#sessions.size + this.#pendingExchanges >= this.#maxSessions) throw new ApiError(429, "SESSION_CAPACITY", "Session capacity is temporarily exhausted", true);
    this.#pendingExchanges += 1;
    try {
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
    } finally {
      this.#pendingExchanges -= 1;
    }
  }

  async authenticate(authorization: string | undefined): Promise<BuyerContext> {
    const now = (this.options.clock?.() ?? new Date()).getTime();
    this.purgeExpired(now);
    const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(authorization ?? "");
    if (!match) throw unauthorized();
    const tokenHash = hash(match[1]!); const session = this.#sessions.get(tokenHash);
    if (!session) throw unauthorized();
    const current = await this.host.reauthorizeBuyer({ issuer: session.issuer, tenantId: session.tenantId, buyerId: session.buyerId, hostSessionId: session.hostSessionId, policyVersion: session.policyVersion });
    if (!current.active || current.policyVersion !== session.policyVersion || Date.parse(session.expiresAt) <= (this.options.clock?.() ?? new Date()).getTime()) { this.#sessions.delete(tokenHash); throw unauthorized(); }
    const { issuer: _issuer, ...context } = session; return context;
  }

  private purgeExpired(now: number): void {
    for (const [key, session] of this.#sessions) {
      const expiresAt = Date.parse(session.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) this.#sessions.delete(key);
    }
  }
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function validClaims(value: StorefrontBootstrapClaims): boolean {
  return typeof value === "object" && value !== null && [value.iss, value.aud, value.sub, value.tenantId, value.hostSessionId, value.policyVersion, value.origin, value.jti].every((item) => typeof item === "string" && item.length > 0);
}
