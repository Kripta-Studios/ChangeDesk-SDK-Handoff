export interface ExpressSessionStoreLike { get(sessionId: string, callback: (error: unknown, session?: unknown) => void): void; }
export class StorefrontSessionRegistry {
  register(_input: { tenantId: string; buyerId: string; rawSessionId: string; expiresAt: number }): string { return "not-implemented"; }
  async authorize(_input: { tenantId: string; buyerId: string; hostSessionId: string; store: ExpressSessionStoreLike; now?: number }): Promise<boolean> { return false; }
}
export const storefrontSessionRegistry = new StorefrontSessionRegistry();
