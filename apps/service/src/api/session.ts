import { createHash, randomBytes, verify, type KeyObject } from "node:crypto";
import type { ActorContext, Role } from "../runtime/types.js";
import { ApiError, forbidden, unauthorized } from "./errors.js";

export interface BootstrapClaims {
  v: 1; typ: "changedesk.bootstrap"; iss: string; aud: string; sub: string; tenantId: string;
  hostSessionId: string; policyVersion: string; origin: string; jti: string; iat: number; exp: number;
}
export interface TicketReplayStore { consumeTicket(input: { tenantId: string; actorId: string; ticketId: string; issuer: string; jti: string; audience: string; expiresAt: Date }): Promise<boolean> }
export interface HostIdentityPort {
  publicKey(issuer: string): Promise<KeyObject>;
  reauthorize(input: { issuer: string; tenantId: string; actorId: string; hostSessionId: string; policyVersion: string }): Promise<{ active: boolean; roles: readonly Role[]; policyVersion: string }>;
}
interface SessionRecord extends ActorContext { issuer: string }

export class SessionManager {
  readonly #sessions = new Map<string, SessionRecord>();
  constructor(private readonly replay: TicketReplayStore, private readonly host: HostIdentityPort, private readonly options: {
    audience: string; issuers: readonly string[]; origins: readonly string[]; ticketMaxTtlSeconds: number; sessionTtlSeconds: number; clock?: () => Date;
  }) {}

  async exchange(ticket: string, requestOrigin: string): Promise<{ accessToken: string; expiresAt: string }> {
    const currentTime = this.options.clock?.() ?? new Date();
    const now = Math.floor(currentTime.getTime() / 1000);
    this.purgeExpired(currentTime.getTime());
    if (this.#sessions.size >= 10_000) throw new ApiError(429, "SESSION_CAPACITY", "Session capacity is temporarily exhausted", true);
    const [payloadPart, signaturePart, extra] = ticket.split(".");
    if (!payloadPart || !signaturePart || extra) throw unauthorized();
    let claims: BootstrapClaims;
    try { claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as BootstrapClaims; } catch { throw unauthorized(); }
    if (claims.v !== 1 || claims.typ !== "changedesk.bootstrap" || claims.aud !== this.options.audience || !this.options.issuers.includes(claims.iss)) throw unauthorized();
    if (claims.origin !== requestOrigin || !this.options.origins.includes(requestOrigin)) throw forbidden();
    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp <= now || claims.iat > now + 5 || claims.exp - claims.iat > this.options.ticketMaxTtlSeconds) throw unauthorized();
    const payload = Buffer.from(payloadPart, "base64url");
    const key = await this.host.publicKey(claims.iss);
    if (!verify(null, payload, key, Buffer.from(signaturePart, "base64url"))) throw unauthorized();
    if (!await this.replay.consumeTicket({ tenantId: claims.tenantId, actorId: claims.sub, ticketId: hashToken(ticket), issuer: claims.iss, jti: claims.jti, audience: claims.aud, expiresAt: new Date(claims.exp * 1000) })) throw unauthorized();
    const current = await this.host.reauthorize({ issuer: claims.iss, tenantId: claims.tenantId, actorId: claims.sub, hostSessionId: claims.hostSessionId, policyVersion: claims.policyVersion });
    if (!current.active || current.policyVersion !== claims.policyVersion) throw unauthorized();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now * 1000 + this.options.sessionTtlSeconds * 1000).toISOString();
    this.#sessions.set(hashToken(token), { issuer: claims.iss, tenantId: claims.tenantId, actorId: claims.sub, hostSessionId: claims.hostSessionId, roles: current.roles, policyVersion: current.policyVersion, expiresAt });
    return { accessToken: token, expiresAt };
  }

  async authenticate(authorization: string | undefined): Promise<ActorContext> {
    const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(authorization ?? "");
    if (!match) throw unauthorized();
    const key = hashToken(match[1]!);
    const session = this.#sessions.get(key);
    if (!session || Date.parse(session.expiresAt) <= (this.options.clock?.() ?? new Date()).getTime()) { this.#sessions.delete(key); throw unauthorized(); }
    const current = await this.host.reauthorize({ issuer: session.issuer, tenantId: session.tenantId, actorId: session.actorId, hostSessionId: session.hostSessionId, policyVersion: session.policyVersion });
    if (!current.active) { this.#sessions.delete(key); throw unauthorized(); }
    return { ...session, roles: current.roles, policyVersion: current.policyVersion };
  }

  private purgeExpired(now: number): void { for (const [key, session] of this.#sessions) if (Date.parse(session.expiresAt) <= now) this.#sessions.delete(key); }
}
function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
