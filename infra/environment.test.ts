import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("local environment contract", () => {
  it("declares exactly the four normative source workspaces", () => {
    const workspace = read("pnpm-workspace.yaml");
    const entries = [...workspace.matchAll(/^\s+-\s+([^\s#]+)\s*$/gm)].map((match) => match[1]);
    expect(entries).toEqual([
      "apps/service",
      "packages/contracts",
      "packages/sdk-react",
      "packages/medusa-plugin"
    ]);
  });

  it("pins a namespaced PostgreSQL image and binds it only to loopback", () => {
    const compose = read("infra/compose.yaml");
    expect(compose).toContain("name: changedesk-sdk-local");
    expect(compose).toContain("postgres:17.11-alpine3.23@sha256:01ea903aa65deb58eb49d6e09d859ecff63a6bb7d61feca55f2abad71d08f72a");
    expect(compose).toContain('127.0.0.1:${CHANGEDESK_POSTGRES_PORT:-5432}:5432');
  });

  it("provisions isolated database owners and unprivileged service roles", () => {
    const init = read("infra/postgres/init/00-create-databases.sh");
    expect(init).toContain("changedesk_migrator");
    expect(init).toContain("atlas_owner");
    expect(init).toContain("boreal_owner");
    expect(init).toContain("changedesk_runtime");
    expect(init).toContain("changedesk_worker");
    expect(init.match(/NOBYPASSRLS/g)).toHaveLength(5);
    expect(init).toContain("REVOKE CONNECT ON DATABASE changedesk FROM PUBLIC");
  });

  it("requires an explicit run id and confirmation before deleting local volumes", () => {
    const reset = read("scripts/reset-local.ps1");
    expect(reset).toContain("[Parameter(Mandatory = $true)][string]$RunId");
    expect(reset).toContain("[Parameter(Mandatory = $true)][switch]$ConfirmLocalDataReset");
    expect(reset).toContain("changedesk-sdk-local");
    expect(reset).toContain("down --volumes");
  });

  it("keeps handoff validation bounded to specification inputs", () => {
    const result = spawnSync("python", [resolve(root, "scripts/validate_handoff.py")], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const report = JSON.parse(read("evidence/handoff-validation.json")) as {
      manifest: Array<{ path: string }>;
    };
    expect(report.manifest.length).toBeLessThan(250);
    expect(report.manifest.some(({ path }) => /(^|\/)(\.worktrees|node_modules|\.tools)(\/|$)/.test(path))).toBe(false);
    expect(report.manifest.every(({ path }) =>
      /^(AGENTS\.md|README\.md|START-HERE\.md|TASKBOARD\.json|(contracts|docs|fixtures|prompts|templates)\/)/.test(path)
    )).toBe(true);
  });
});
