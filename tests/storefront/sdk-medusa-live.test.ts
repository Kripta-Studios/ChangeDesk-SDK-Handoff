import { describe, expect, it, vi } from "vitest";
import { createMedusaBuyerSession } from "../../packages/sdk-react/src/storefront/medusa.js";

describe("Medusa storefront live session adapter", () => {
  it("logs in with a native customer cookie then exchanges an origin-bound ticket", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.endsWith("/auth/customer/emailpass")) return Response.json({ token: "registration-token" });
      if (url.endsWith("/auth/session")) return new Response(null, { status: 200 });
      if (url.endsWith("/store/customers/me/changedesk/session")) return Response.json({ ticket: "signed-ticket", expiresAt: "2026-10-24T18:00:00.000Z" });
      if (url.endsWith("/v1/storefront/session/exchange")) return Response.json({ accessToken: "buyer-access-token", expiresAt: "2026-10-24T18:05:00.000Z" });
      throw new Error(`unexpected ${url}`);
    });
    const session = createMedusaBuyerSession({ host: "http://127.0.0.1:9001", endpoint: "http://127.0.0.1:4100", publishableApiKey: "pk_fixture", fetch: fetcher as typeof fetch });

    await session.login({ email: "buyer@atlas.test", password: "private" });
    await expect(session.getSession()).resolves.toEqual({ accessToken: "buyer-access-token", expiresAt: "2026-10-24T18:05:00.000Z" });

    expect(calls.map(({ url }) => url)).toEqual([
      "http://127.0.0.1:9001/auth/customer/emailpass",
      "http://127.0.0.1:9001/auth/session",
      "http://127.0.0.1:9001/store/customers/me/changedesk/session",
      "http://127.0.0.1:4100/v1/storefront/session/exchange",
    ]);
    expect(calls[1]!.init).toMatchObject({ method: "POST", credentials: "include", headers: { Authorization: "Bearer registration-token" } });
    expect(calls[2]!.init).toMatchObject({ method: "POST", credentials: "include", headers: { "X-ChangeDesk-CSRF": "1", "x-publishable-api-key": "pk_fixture" } });
    expect(calls[3]!.init).toMatchObject({ method: "POST", credentials: "omit" });
    expect((calls[3]!.init!.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("logs out natively and does not retain customer credentials", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    const session = createMedusaBuyerSession({ host: "http://127.0.0.1:9002", endpoint: "http://127.0.0.1:4100", fetch: fetcher as typeof fetch });
    await session.logout();
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:9002/auth/session", expect.objectContaining({ method: "DELETE", credentials: "include" }));
  });

  it("rejects non-origin URLs and malformed host/session responses", async () => {
    expect(() => createMedusaBuyerSession({ host: "https://example.test/path", endpoint: "http://127.0.0.1:4100" })).toThrow(/origen fijo/);
    const session = createMedusaBuyerSession({ host: "http://127.0.0.1:9001", endpoint: "http://127.0.0.1:4100", fetch: (async () => Response.json({ token: "" })) as typeof fetch });
    await expect(session.login({ email: "a@b.test", password: "x" })).rejects.toThrow(/autenticar/);
  });
});
