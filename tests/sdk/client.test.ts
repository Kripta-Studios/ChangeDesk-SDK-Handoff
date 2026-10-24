import { describe, expect, it, vi } from "vitest";

import { ChangeDeskApiError, createChangeDeskClient } from "../../packages/sdk-react/src/client.js";

describe("ChangeDesk HTTP client", () => {
  it("keeps the session in memory, refreshes it once, and never serializes the token", async () => {
    const getSession = vi.fn().mockResolvedValue({ accessToken: "secret-token", expiresAt: "2099-01-01T00:00:00.000Z" });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: "req_1", status: "received" }), {
      status: 202,
      headers: { "content-type": "application/json" },
    }));
    const client = createChangeDeskClient({ endpoint: "https://desk.example.test", getSession, fetch: fetcher });

    await client.createRequest({ message: "Prepara la campaña", selectedProductIds: ["prod_1"], locale: "es", clientRequestId: crypto.randomUUID() });
    await client.createRequest({ message: "Otra campaña", selectedProductIds: ["prod_2"], locale: "es", clientRequestId: crypto.randomUUID() });

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls) {
      expect(init.headers.Authorization).toBe("Bearer secret-token");
      expect(init.body).not.toContain("secret-token");
    }
    expect(Object.keys(client)).not.toContain("accessToken");
  });

  it("sends an Idempotency-Key for every mutation and mirrors schema body keys", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ approvalId: "approval_1" }), { status: 201, headers: { "content-type": "application/json" } }));
    const client = createChangeDeskClient({ endpoint: "http://localhost:4400", getSession: async () => ({ accessToken: "t", expiresAt: "2099-01-01T00:00:00Z" }), fetch: fetcher });
    const key = crypto.randomUUID();

    await client.approvePlan({ planId: "plan_1", planHash: "a".repeat(64), expectedPlanVersion: 1, idempotencyKey: key });

    const [, init] = fetcher.mock.calls[0]!;
    expect(init.headers["Idempotency-Key"]).toBe(key);
    expect(JSON.parse(init.body).idempotencyKey).toBe(key);
  });

  it("rejects non-local HTTP endpoints and returns uniform API errors", async () => {
    expect(() => createChangeDeskClient({ endpoint: "http://desk.example.test", getSession: vi.fn(), fetch: vi.fn() })).toThrow(/HTTPS/);
    const client = createChangeDeskClient({
      endpoint: "https://desk.example.test/",
      getSession: async () => ({ accessToken: "t", expiresAt: "2099-01-01T00:00:00Z" }),
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "forbidden", message: "No permitido", requestId: "trace_1", retryable: false } }), { status: 403, headers: { "content-type": "application/json" } })),
    });

    await expect(client.getRequest("req_1")).rejects.toMatchObject({ code: "forbidden", requestId: "trace_1", retryable: false } satisfies Partial<ChangeDeskApiError>);
  });

  it("offers only the documented finite client surface", () => {
    const client = createChangeDeskClient({ endpoint: "http://localhost:4400", getSession: vi.fn(), fetch: vi.fn() });
    expect(Object.keys(client).sort()).toEqual([
      "approvePlan", "cancelExecution", "clearSession", "createPlan", "createRequest", "getEvidence", "getExecution", "getInstallations", "getPlan", "getRequest", "getResources", "installAction", "publishAction", "resumeExecution", "revokePublication", "selectCandidate", "sendMessage", "startExecution",
    ]);
    expect(client).not.toHaveProperty("rawFetch");
    expect(client).not.toHaveProperty("executeCode");
    expect(client).not.toHaveProperty("setTenant");
    expect(client).not.toHaveProperty("grantRole");
  });

  it("cannot repopulate a cleared session from a stale pending bridge promise", async () => {
    let resolveFirst!: (value: { accessToken: string; expiresAt: string }) => void;
    const getSession = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ accessToken: "new-actor-token", expiresAt: "2099-01-01T00:00:00Z" });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: "req_2", status: "received" }), { status: 202, headers: { "content-type": "application/json" } }));
    const client = createChangeDeskClient({ endpoint: "https://desk.example.test", getSession, fetch: fetcher });
    const stale = client.createRequest({ message: "old actor", selectedProductIds: ["p1"], clientRequestId: crypto.randomUUID() });
    client.clearSession();
    resolveFirst({ accessToken: "old-actor-token", expiresAt: "2099-01-01T00:00:00Z" });
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    await client.createRequest({ message: "new actor", selectedProductIds: ["p2"], clientRequestId: crypto.randomUUID() });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: "Bearer new-actor-token" });
  });
});
