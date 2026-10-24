import { generateKeyPairSync, sign } from "node:crypto";
import canonicalize from "canonicalize";
import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/api/session.js";

describe("bootstrap exchange", () => {
  it("ACC-003 accepts a signed 60s ticket once and reauthorizes every bearer use", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const consumed = new Set<string>();
    const replay = { consumeTicket: vi.fn(async ({ jti }: { jti: string }) => !consumed.has(jti) && !!consumed.add(jti)) } as any;
    const host = { publicKey: vi.fn().mockResolvedValue(publicKey), reauthorize: vi.fn().mockResolvedValue({ active: true, roles: ["operator"], policyVersion: "p1" }) };
    const manager = new SessionManager(replay, host, { audience: "changedesk", issuers: ["atlas"], origins: ["http://localhost:9001"], ticketMaxTtlSeconds: 60, sessionTtlSeconds: 300, clock: () => new Date("2026-10-24T12:00:00Z") });
    const claims = { v: 1, typ: "changedesk.bootstrap", iss: "atlas", aud: "changedesk", sub: "operator", tenantId: "atlas", hostSessionId: "hs", policyVersion: "p1", origin: "http://localhost:9001", jti: "once", iat: 1792843200, exp: 1792843260 } as const;
    const payload = Buffer.from(canonicalize(claims)!, "utf8");
    const ticket = `${payload.toString("base64url")}.${sign(null, payload, privateKey).toString("base64url")}`;
    const session = await manager.exchange(ticket, claims.origin);
    expect((await manager.authenticate(`Bearer ${session.accessToken}`)).tenantId).toBe("atlas");
    await expect(manager.exchange(ticket, claims.origin)).rejects.toMatchObject({ statusCode: 401 });
    expect(host.reauthorize).toHaveBeenCalledTimes(3);
  });

  it("ACC-003 rejects a client-selected origin", async () => {
    const manager = new SessionManager({ consumeTicket: vi.fn() }, { publicKey: vi.fn(), reauthorize: vi.fn() }, { audience: "changedesk", issuers: ["atlas"], origins: ["http://localhost:9001"], ticketMaxTtlSeconds: 60, sessionTtlSeconds: 300 });
    await expect(manager.exchange("bad.ticket", "https://attacker.invalid")).rejects.toMatchObject({ statusCode: 401 });
  });
});
