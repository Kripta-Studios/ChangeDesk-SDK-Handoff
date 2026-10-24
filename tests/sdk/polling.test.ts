import { afterEach, describe, expect, it, vi } from "vitest";

import { pollResource } from "../../packages/sdk-react/src/polling.js";

describe("pollResource", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("polls every 2 seconds while visible and 10 seconds in the background", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue({ state: "running" });
    const controller = pollResource(load, { isTerminal: () => false });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(load).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(3);
    controller.abort();
  });

  it("aborts in-flight work and schedules nothing after unmount", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const load = vi.fn((nextSignal: AbortSignal) => {
      signal = nextSignal;
      return new Promise(() => undefined);
    });
    const controller = pollResource(load, { isTerminal: () => false });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
