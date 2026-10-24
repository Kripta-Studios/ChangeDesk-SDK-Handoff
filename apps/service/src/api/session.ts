import { createHash, randomBytes, verify, type KeyObject } from "node:crypto";
import type { ActorContext, Role } from "../runtime/types.js";
import { ApiError, forbidden, unauthorized } from "./errors.js";
import { Store, StorageConflictError } from "../storage/index.js";

export interface BootstrapClaims {
  v: 1; typ: "changedesk.bootstrap"; iss: string; aud: string; sub: string; tenantId: string;
  hostSessionId: string; policyVersion: string; origin: string; jti: string; iat: number; exp: number;
}
export interface SessionPersistence { exchangeTicket(input: { tenantId: string; actorId: string; ticketId: string; issuer: string; jti: string; audience: string; ticketExpiresAt: Date; sessionId: string; policyVersion: string; sessionExpiresAt: Date }): Promise<boolean> }
export interface HostIdentityPort {
  publicKey(issuer: string): Promise<KeyObject>;
  reauthorize(input: { issuer: string; tenantId: string; actorId: string; hostSessionId: string; policyVersion: string }): Promise<{ active: boolean; roles: readonly Role[]; policyVersion: string }>;
}
interface SessionRecord extends ActorContext { issuer: string }

export class SessionManager {
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #consumedTickets = new Map<string, number>();
  constructor(private readonly replay: SessionPersistence, private readonly host: HostIdentityPort, private readonly options: {
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
    const ticketHash = hashToken(ticket);
    if ((this.#consumedTickets.get(ticketHash) ?? 0) > currentTime.getTime()) throw unauthorized();
    const current = await this.host.reauthorize({ issuer: claims.iss, tenantId: claims.tenantId, actorId: claims.sub, hostSessionId: claims.hostSessionId, policyVersion: claims.policyVersion });
    if (!current.active || current.policyVersion !== claims.policyVersion) throw unauthorized();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now * 1000 + this.options.sessionTtlSeconds * 1000).toISOString();
    if (!await this.replay.exchangeTicket({ tenantId: claims.tenantId, actorId: claims.sub, ticketId: ticketHash, issuer: claims.iss, jti: claims.jti, audience: claims.aud, ticketExpiresAt: new Date(claims.exp * 1000), sessionId: claims.hostSessionId, policyVersion: current.policyVersion, sessionExpiresAt: new Date(expiresAt) })) throw unauthorized();
    this.#consumedTickets.set(ticketHash, claims.exp * 1000);
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

  private purgeExpired(now: number): void {
    for (const [key, session] of this.#sessions) if (Date.parse(session.expiresAt) <= now) this.#sessions.delete(key);
    for (const [key, expiresAt] of this.#consumedTickets) if (expiresAt <= now) this.#consumedTickets.delete(key);
  }
}
export class StorageSessionPersistence implements SessionPersistence {
  constructor(private readonly store: Store) {}
  async exchangeTicket(input: Parameters<SessionPersistence["exchangeTicket"]>[0]): Promise<boolean> {
    const jtiHash = createHash("sha256").update(input.jti, "utf8").digest("hex");
    try { await this.store.withTenant({ tenantId: input.tenantId, actorId: input.actorId }, (tx) => tx.exchangeSessionTicket({ ticketId: input.ticketId, issuer: input.issuer, jtiHash, nonceHash: jtiHash, audience: input.audience, sessionId: input.sessionId, policyVersion: input.policyVersion, ticketExpiresAt: input.ticketExpiresAt, sessionExpiresAt: input.sessionExpiresAt })); return true; }
    catch (error) { if (error instanceof StorageConflictError) return false; throw error; }
  }
}
function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
