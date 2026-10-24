import { describe, expect, it } from "vitest";

// @ts-expect-error Executable tooling intentionally has no declaration bundle.
import { validatePostgresEnvironment, verificationCommands } from "../../scripts/verify-ci.mjs";

describe("CI lane contracts", () => {
  it("defines concrete, non-empty commands for every non-live lane", () => {
    for (const lane of ["deterministic", "build", "unit", "functional", "postgres", "medusa", "browser", "inventory"]) {
      const commands = verificationCommands(lane);
      expect(commands.length, lane).toBeGreaterThan(0);
      expect(commands.every((command: { command?: string; args?: string[] }) => command.command && command.args?.length)).toBe(true);
      if (lane !== "deterministic") expect(commands.map((command: { name: string }) => command.name).join(" ")).toMatch(new RegExp(lane, "i"));
    }
  });

  it("runs storefront, planner and backend security functional suites without live-provider or PostgreSQL tests", () => {
    const args = verificationCommands("functional").flatMap((command: { args: string[] }) => command.args).join(" ");
    expect(args).toMatch(/tests\/storefront/);
    expect(args).toMatch(/tests\/planner/);
    expect(args).toMatch(/tests\/security/);
    expect(args).not.toMatch(/live\.codex|\.integration|postgres\.live/);
  });

  it("keeps database, Medusa and browser execution out of the deterministic lane", () => {
    const names = verificationCommands("deterministic").map((command: { name: string }) => command.name).join(" ");
    expect(names).not.toMatch(/postgres|medusa|browser|playwright/i);
  });

  it("rejects an unknown lane instead of returning a green no-op", () => {
    expect(() => verificationCommands("unknown")).toThrow(/Unknown verification lane/);
  });

  it("refuses the demo database and accepts only one explicit run-scoped integration database", () => {
    const common = { CHANGEDESK_RUNTIME_DATABASE_URL: "postgresql://runtime:x@127.0.0.1/changedesk_test_123", CHANGEDESK_WORKER_DATABASE_URL: "postgresql://worker:x@127.0.0.1/changedesk_test_123", CHANGEDESK_INTEGRATION_DATABASE_SCOPE: "changedesk_test_123" };
    expect(() => validatePostgresEnvironment({ ...common, CHANGEDESK_MIGRATOR_DATABASE_URL: "postgresql://migrator:x@127.0.0.1/changedesk" })).toThrow(/run-scoped/);
    expect(() => validatePostgresEnvironment({ ...common, CHANGEDESK_MIGRATOR_DATABASE_URL: "postgresql://migrator:x@127.0.0.1/changedesk_test_123" })).not.toThrow();
  });
});
