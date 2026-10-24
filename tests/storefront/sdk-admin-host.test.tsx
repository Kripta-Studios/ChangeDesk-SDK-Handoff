// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@medusajs/admin-sdk", () => ({ defineRouteConfig: (value: unknown) => value }));
vi.mock("../../packages/medusa-plugin/src/admin/changedesk-config.js", () => ({
  medusaChangeDeskConfig: () => ({ endpoint: "https://desk.example.test", getSession: mocks.getSession }),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Medusa storefront administrator host boundary", () => {
  it("clears the old client and creates a fresh server-session client when the host regains focus", async () => {
    let sessionNumber = 0;
    mocks.getSession.mockImplementation(async () => ({ accessToken: `staff-${++sessionNumber}`, expiresAt: "2099-01-01T00:00:00.000Z" }));
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ proposals: [] }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const { default: StorefrontReviewPage } = await import("../../packages/medusa-plugin/src/admin/routes/changedesk-storefront/page.js");
    render(<StorefrontReviewPage />);
    expect(await screen.findByText("No hay propuestas pendientes.")).toBeTruthy();
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalledTimes(2));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer staff-1");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe("Bearer staff-2");
  });
});
