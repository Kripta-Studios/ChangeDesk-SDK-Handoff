import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BuyerSessionManager, type BuyerHostIdentityPort, type StorefrontBootstrapClaims, type StorefrontTicketReplayStore } from "../../apps/service/src/storefront/session.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const now = new Date("2026-10-24T12:00:00.000Z");
const baseClaims: StorefrontBootstrapClaims = { v: 1, typ: "changedesk.storefront.bootstrap", iss: "atlas-host", aud: "changedesk-storefront", sub: "buyer-1", tenantId: "atlas", hostSessionId: "host-session", policyVersion: "buyer-v1", origin: "https://atlas.test", jti: "00000000-0000-4000-8000-000000000001", iat: Math.floor(now.getTime() / 1000), exp: Math.floor(now.getTime() / 1000) + 60 };
const ticket = (claims: object, key = privateKey) => { const payload = Buffer.from(JSON.stringify(claims)); return `${payload.toString("base64url")}.${sign(null, payload, key).toString("base64url")}`; };

describe("buyer session domain", () => {
  it("exchanges a one-use storefront ticket and reauthorizes every request", async () => {
    const consumed = new Set<string>(); let active = true;
    const replay: StorefrontTicketReplayStore = { consumeTicket: async ({ jti }) => !consumed.has(jti) && !!consumed.add(jti) };
    const host: BuyerHostIdentityPort = { publicKey: async () => publicKey, reauthorizeBuyer: async () => ({ active, policyVersion: "buyer-v1" }) };
    const manager = new BuyerSessionManager(replay, host, { audience: "changedesk-storefront", issuers: ["atlas-host"], origins: ["https://atlas.test"], ticketMaxTtlSeconds: 60, sessionTtlSeconds: 300, clock: () => now });
    const session = await manager.exchange(ticket(baseClaims), "https://atlas.test");
    expect(await manager.authenticate(`Bearer ${session.accessToken}`)).toMatchObject({ kind: "buyer", tenantId: "atlas", buyerId: "buyer-1", hostSessionId: "host-session" });
    await expect(manager.exchange(ticket(baseClaims), "https://atlas.test")).rejects.toMatchObject({ statusCode: 401 });
    active = false;
    await expect(manager.authenticate(`Bearer ${session.accessToken}`)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects staff typ, wrong audience, wrong origin, and signature tampering", async () => {
    const manager = new BuyerSessionManager({ consumeTicket: async () => true }, { publicKey: async () => publicKey, reauthorizeBuyer: async () => ({ active: true, policyVersion: "buyer-v1" }) }, { audience: "changedesk-storefront", issuers: ["atlas-host"], origins: ["https://atlas.test"], ticketMaxTtlSeconds: 60, sessionTtlSeconds: 300, clock: () => now });
    for (const invalid of [
      ticket({ ...baseClaims, typ: "changedesk.bootstrap" }),
      ticket({ ...baseClaims, aud: "changedesk-staff" }),
      ticket({ ...baseClaims, origin: "https://evil.test" }),
      `${ticket(baseClaims).slice(0, -1)}A`,
    ]) await expect(manager.exchange(invalid, "https://atlas.test")).rejects.toMatchObject({ statusCode: expect.any(Number) });
  });
});
