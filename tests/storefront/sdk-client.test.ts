import { describe, expect, it } from "vitest";
import { createStorefrontClient, StorefrontApiError } from "../../packages/sdk-react/src/storefront/client.js";

const preferences = { overrides: {}, effective: { theme: "system", density: "comfortable", productLayout: "grid" }, buyerRevision: 0, globalRevision: 0 };

describe("storefront buyer client", () => {
  it("uses PUT replacement with UUID idempotency and reports 409", async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const client = createStorefrontClient({ endpoint: "http://localhost:4100", getSession: async () => ({ accessToken: "buyer-token", expiresAt: "2099-01-01T00:00:00.000Z" }), fetch: async (input, init) => { request = { input, init }; return new Response(JSON.stringify({ error: { code: "stale_buyer_revision", message: "reload", requestId: "r", retryable: false } }), { status: 409, headers: { "content-type": "application/json" } }); } });
    await expect(client.replacePreferences({ expectedRevision: 0, overrides: { theme: "dark" } })).rejects.toMatchObject<Partial<StorefrontApiError>>({ status: 409, code: "stale_buyer_revision" });
    expect(request?.init?.method).toBe("PUT"); expect(new Headers(request?.init?.headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("invalidates cached data and a late response after logout/session switch", async () => {
    let resolve!: (response: Response) => void;
    const client = createStorefrontClient({ endpoint: "http://localhost:4100", getSession: async () => ({ accessToken: "buyer-token", expiresAt: "2099-01-01T00:00:00.000Z" }), fetch: () => new Promise((done) => { resolve = done; }) });
    const pending = client.getPreferences(); client.clearSession(); resolve(new Response(JSON.stringify(preferences), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
