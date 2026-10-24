import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BuyerSessionManager, type BuyerHostIdentityPort, type StorefrontBootstrapClaims, type StorefrontTicketReplayStore } from "../../apps/service/src/storefront/session.js";
import { loadConfig } from "../../apps/service/src/config.js";
import { ConfiguredBuyerHostRegistry } from "../../apps/service/src/storefront/host-registry.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const now = new Date("2026-10-24T12:00:00.000Z");
const baseClaims: StorefrontBootstrapClaims = { v: 1, typ: "changedesk.storefront.bootstrap", iss: "atlas-host", aud: "changedesk-storefront", sub: "buyer-1", tenantId: "atlas", hostSessionId: "host-session", policyVersion: "buyer-v1", origin: "https://atlas.test", jti: "00000000-0000-4000-8000-000000000001", iat: Math.floor(now.getTime() / 1000), exp: Math.floor(now.getTime() / 1000) + 60 };
const ticket = (claims: object, key = privateKey) => { const payload = Buffer.from(JSON.stringify(claims)); return `${payload.toString("base64url")}.${sign(null, payload, key).toString("base64url")}`; };

describe("buyer session domain", () => {
  it("uses the parsed HostConfig bootstrapIssuer for key lookup and reauthorization", async () => {
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const host = (tenantId: string) => ({ tenantId, bootstrapIssuer: `${tenantId}-host`, delegationIssuer: `${tenantId}-delegation`, audience: "changedesk", commandUrl: `https://${tenantId}.test/commands`, reauthorizeUrl: `https://${tenantId}.test/changedesk/bridge/v1/authorize`, bootstrapPublicKeyPem: publicKeyPem, delegationPrivateKeyPem: privateKeyPem, serviceToken: `${tenantId}-service`, authorityCallbackCredential: `${tenantId}-callback`, categoryIds: [], channelIds: [] });
    const config = loadConfig({
      CHANGEDESK_API_DATABASE_URL: "postgres://fixture/api",
      CHANGEDESK_WORKER_DATABASE_URL: "postgres://fixture/worker",
      CHANGEDESK_ORIGINS: "https://atlas.test",
      CHANGEDESK_SESSION_AUDIENCE: "changedesk",
      CHANGEDESK_SESSION_ISSUERS: "atlas-host,boreal-host",
      CHANGEDESK_HOSTS_JSON: JSON.stringify([host("atlas"), host("boreal")]),
      CHANGEDESK_PUBLICATION_KEY_ID: "fixture",
      CHANGEDESK_PUBLICATION_PRIVATE_KEY_PEM: privateKeyPem,
    });
    let requestedUrl = "";
    const registry = new ConfiguredBuyerHostRegistry(config.hosts, async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ active: true, policyVersion: "buyer-v1" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(registry.publicKey("atlas-host")).resolves.toBeDefined();
    await expect(registry.reauthorizeBuyer({ issuer: "atlas-host", tenantId: "atlas", buyerId: "buyer-1", hostSessionId: "host-1", policyVersion: "buyer-v1" })).resolves.toEqual({ active: true, policyVersion: "buyer-v1" });
    expect(requestedUrl).toBe("https://atlas.test/changedesk/bridge/v1/storefront/authorize");
  });

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
    const [validPayload, validSignature] = ticket(baseClaims).split(".") as [string, string];
    const tampered = `${validPayload}.${validSignature[0] === "A" ? "B" : "A"}${validSignature.slice(1)}`;
    for (const invalid of [
      ticket({ ...baseClaims, typ: "changedesk.bootstrap" }),
      ticket({ ...baseClaims, aud: "changedesk-staff" }),
      ticket({ ...baseClaims, origin: "https://evil.test" }),
      tampered,
    ]) await expect(manager.exchange(invalid, "https://atlas.test")).rejects.toMatchObject({ statusCode: expect.any(Number) });
  });
});
