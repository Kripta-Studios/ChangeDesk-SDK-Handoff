import { describe, expect, it } from "vitest";

// @ts-expect-error Executable tooling intentionally has no declaration bundle.
import { verificationCommands } from "../../scripts/verify-ci.mjs";

describe("CI lane contracts", () => {
  it("defines concrete, non-empty commands for every non-live lane", () => {
    for (const lane of ["deterministic", "build", "unit", "postgres", "medusa", "browser", "inventory"]) {
      const commands = verificationCommands(lane);
      expect(commands.length, lane).toBeGreaterThan(0);
      expect(commands.every((command: { command?: string; args?: string[] }) => command.command && command.args?.length)).toBe(true);
      if (lane !== "deterministic") expect(commands.map((command: { name: string }) => command.name).join(" ")).toMatch(new RegExp(lane, "i"));
    }
  });

  it("keeps database, Medusa and browser execution out of the deterministic lane", () => {
    const names = verificationCommands("deterministic").map((command: { name: string }) => command.name).join(" ");
    expect(names).not.toMatch(/postgres|medusa|browser|playwright/i);
  });

  it("rejects an unknown lane instead of returning a green no-op", () => {
    expect(() => verificationCommands("unknown")).toThrow(/Unknown verification lane/);
  });
});
