import { describe, expect, it } from "vitest";

// @ts-expect-error The executable module has no declaration file.
import { percentile, summarize, requireBenchmarkEnvironment } from "../../scripts/benchmark-support.mjs";

describe("performance evidence helpers", () => {
  it("uses nearest-rank percentiles without averaging away tail latency", () => {
    expect(percentile(Array.from({ length: 100 }, (_, index) => index + 1), 0.95)).toBe(95);
  });

  it("reports count, errors and stable latency units", () => {
    expect(summarize([3, 1, 2], 4)).toEqual({ samples: 3, errors: 4, unit: "ms", min: 1, p50: 2, p95: 3, p99: 3, max: 3 });
  });

  it("marks missing real PostgreSQL configuration BLOCKED", () => {
    expect(() => requireBenchmarkEnvironment({})).toThrow(/BLOCKED.*CHANGEDESK_MIGRATOR_DATABASE_URL.*CHANGEDESK_RUNTIME_DATABASE_URL/);
  });
});
