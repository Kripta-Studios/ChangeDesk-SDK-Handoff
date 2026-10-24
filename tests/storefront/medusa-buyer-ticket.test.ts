import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyEnvelope } from "../../packages/medusa-plugin/src/bridge/crypto.js";
import { hashStorefrontHostSession, issueStorefrontBootstrapTicket, storefrontAudience, storefrontSessionBinding, type StorefrontTicketClaims } from "../../packages/medusa-plugin/src/storefront/ticket.js";

describe("Medusa buyer storefront ticket", () => {
  it("uses a separate typ/audience and binds opaque buyer host session", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const result = issueStorefrontBootstrapTicket({ issuer: "atlas-host", serviceAudience: "changedesk", tenantId: "atlas", buyerId: "buyer-1", hostSessionId: hashStorefrontHostSession("secret-cookie-or-token"), origin: "https://atlas.test", now: 1_798_800_000, privateKey, jti: "jti-1" });
    expect(storefrontAudience("changedesk")).toBe("changedesk:storefront");
    expect(verifyEnvelope<StorefrontTicketClaims>(result.ticket, publicKey)).toEqual(result.claims);
    expect(result.claims).toMatchObject({ typ: "changedesk.storefront.bootstrap", aud: "changedesk:storefront", sub: "buyer-1", tenantId: "atlas", policyVersion: "storefront-buyer-v1" });
    expect(result.claims.hostSessionId).not.toContain("secret-cookie-or-token");
    expect(storefrontSessionBinding("atlas", "buyer-1", result.claims.hostSessionId)).toMatch(/^[a-f0-9]{64}$/);
  });
});
