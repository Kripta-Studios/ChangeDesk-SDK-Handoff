import { describe, expect, it, vi } from "vitest";
import { createStorefrontAdminClient, createStorefrontClient, StorefrontApiError } from "../../packages/sdk-react/src/storefront/client.js";

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
    const pending = client.getPreferences(); await vi.waitFor(() => expect(resolve).toBeTypeOf("function")); client.clearSession(); resolve(new Response(JSON.stringify(preferences), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("validates fixed endpoints, sessions and closed response bodies", async () => {
    expect(() => createStorefrontClient({ endpoint: "http://desk.example.test", getSession: async () => ({ accessToken: "x", expiresAt: "2099-01-01T00:00:00Z" }) })).toThrow(/HTTPS/);
    expect(() => createStorefrontClient({ endpoint: "https://user:secret@desk.example.test", getSession: async () => ({ accessToken: "x", expiresAt: "2099-01-01T00:00:00Z" }) })).toThrow(/origen fijo/);
    const invalidResponse = createStorefrontClient({ endpoint: "https://desk.example.test", getSession: async () => ({ accessToken: "x", expiresAt: "2099-01-01T00:00:00Z" }), fetch: async () => new Response(JSON.stringify({ ...preferences, tenantId: "leak" }), { headers: { "content-type": "application/json" } }) });
    await expect(invalidResponse.getPreferences()).rejects.toThrow(/respuesta.*inválida/i);
  });

  it("keeps buyer and administrator routes and request bodies separate", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      const path = new URL(String(input)).pathname;
      const payload = path.endsWith("/approve") || path.endsWith("/reject") || path.endsWith("/p1")
        ? { proposalId: "p1", proposalRevision: 1, current: preferences.effective, proposed: preferences.effective, globalRevision: 0, precedenceNotice: "Overrides remain", status: path.endsWith("/reject") ? "rejected" : "pending" }
        : path.includes("/admin/") ? { proposals: [] }
        : path.endsWith("/global-change-proposals") ? { id: "p1", baseGlobalRevision: 0, proposed: preferences.effective, status: "pending", proposalRevision: 1, createdAt: "2026-10-24T12:00:00.000Z" }
        : preferences;
      return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
    };
    const session = async () => ({ accessToken: "scoped-token", expiresAt: "2099-01-01T00:00:00Z" });
    const buyer = createStorefrontClient({ endpoint: "https://desk.example.test", getSession: session, fetch: fetcher });
    const admin = createStorefrontAdminClient({ endpoint: "https://desk.example.test", getSession: session, fetch: fetcher });
    expect("approveProposal" in buyer).toBe(false);
    await buyer.createGlobalProposal({ baseGlobalRevision: 0, proposed: preferences.effective });
    await admin.listProposals();
    await admin.approveProposal("p1", 1, 0);
    await admin.rejectProposal("p1", 1);
    expect(requests.map((item) => new URL(item.url).pathname)).toEqual([
      "/v1/storefront/global-change-proposals",
      "/v1/storefront/admin/global-change-proposals",
      "/v1/storefront/admin/global-change-proposals/p1/approve",
      "/v1/storefront/admin/global-change-proposals/p1/reject",
    ]);
    expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({ expectedProposalRevision: 1, expectedGlobalRevision: 0 });
    expect(JSON.parse(String(requests[3]?.init?.body))).toEqual({ expectedProposalRevision: 1 });
    expect(requests.slice(0, 1).concat(requests.slice(2)).every((item) => /^[0-9a-f-]{36}$/.test(new Headers(item.init?.headers).get("Idempotency-Key") ?? ""))).toBe(true);
  });
});
