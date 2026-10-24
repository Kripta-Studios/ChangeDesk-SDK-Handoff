import { randomUUID } from "node:crypto";
import { BridgeError } from "../bridge/errors.ts";

export interface ExpressSessionStoreLike { get(sessionId: string, callback: (error: unknown, session?: unknown) => void): void; }
export class StorefrontSessionRegistry {
  readonly #entries = new Map<string, { tenantId: string; buyerId: string; rawSessionId: string; expiresAt: number }>();
  constructor(private readonly capacity = 10_000, private readonly createReference: () => string = randomUUID, private readonly storeTimeoutMs = 250) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new RangeError("capacity must be a positive safe integer");
  }
  register(input: { tenantId: string; buyerId: string; rawSessionId: string; expiresAt: number }): string {
    this.prune(Date.now());
    for (const [reference, entry] of this.#entries) {
      if (entry.tenantId === input.tenantId && entry.buyerId === input.buyerId && entry.rawSessionId === input.rawSessionId) {
        entry.expiresAt = input.expiresAt;
        return reference;
      }
    }
    if (this.#entries.size >= this.capacity) throw new BridgeError(429, "storefront_session_capacity", "Storefront session capacity is temporarily exhausted");
    const reference = `sf_${this.createReference()}`;
    this.#entries.set(reference, { ...input });
    return reference;
  }
  async authorize(input: { tenantId: string; buyerId: string; hostSessionId: string; store: ExpressSessionStoreLike; now?: number }): Promise<boolean> {
    const now = input.now ?? Date.now(); const entry = this.#entries.get(input.hostSessionId);
    if (!entry || entry.tenantId !== input.tenantId || entry.buyerId !== input.buyerId || entry.expiresAt <= now) { this.#entries.delete(input.hostSessionId); return false; }
    const session = await new Promise<unknown>((resolve) => {
      const timeout = setTimeout(() => resolve(undefined), this.storeTimeoutMs);
      input.store.get(entry.rawSessionId, (error, value) => { clearTimeout(timeout); resolve(error ? undefined : value); });
    });
    const auth = isRecord(session) && isRecord(session.auth_context) ? session.auth_context : undefined;
    const cookie = isRecord(session) && isRecord(session.cookie) ? session.cookie : undefined;
    const cookieExpiry = cookie?.expires === undefined ? Number.POSITIVE_INFINITY : Date.parse(String(cookie.expires));
    const active = auth?.actor_type === "customer" && auth.actor_id === input.buyerId && (cookieExpiry === Number.POSITIVE_INFINITY || (Number.isFinite(cookieExpiry) && cookieExpiry > now));
    if (!active) this.#entries.delete(input.hostSessionId);
    return active;
  }
  private prune(now: number): void { for (const [key, value] of this.#entries) if (value.expiresAt <= now) this.#entries.delete(key); }
}
export const storefrontSessionRegistry = new StorefrontSessionRegistry();
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
