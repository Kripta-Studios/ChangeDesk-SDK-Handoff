import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// JavaScript tooling is intentionally executable without a TypeScript build.
// @ts-expect-error The executable module has no declaration file.
import { inspectRepository } from "../../scripts/verify-locks.mjs";

async function fixture(name: string, { version = "1.2.3", actionRef = "a".repeat(40), image = "postgres@sha256:" + "b".repeat(64) } = {}) {
  const root = path.resolve(".tools", "test-tmp", `lock-${process.pid}-${name}`);
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { example: version } }));
  for (const workspace of ["apps/service", "packages/contracts", "packages/sdk-react", "packages/medusa-plugin"]) {
    await mkdir(path.join(root, workspace), { recursive: true });
    await writeFile(path.join(root, workspace, "package.json"), JSON.stringify({ private: true }));
  }
  await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(path.join(root, "pnpm-workspace.yaml"), [
    "packages:",
    "  - apps/service",
    "  - packages/contracts",
    "  - packages/sdk-react",
    "  - packages/medusa-plugin",
    "minimumReleaseAgeExclude:",
    "  - example@1.2.3",
    ""
  ].join("\n"));
  await writeFile(path.join(root, ".github", "workflows", "ci.yml"), [
    "jobs:",
    "  test:",
    `    uses: actions/checkout@${actionRef}`,
    "    services:",
    "      postgres:",
    `        image: ${image}`,
    ""
  ].join("\n"));
  await writeFile(path.join(root, ".github", "actions-lock.json"), JSON.stringify({ actions: { "actions/checkout": { commit: actionRef } } }));
  return root;
}

describe("repository pin verification", () => {
  it("accepts exact dependency, action, image and workspace pins", async () => {
    expect((await inspectRepository(await fixture("valid"))).errors).toEqual([]);
  });

  it("rejects floating dependency versions", async () => {
    expect((await inspectRepository(await fixture("floating-dependency", { version: "^1.2.3" }))).errors.join("\n")).toMatch(/floating dependency/);
  });

  it("rejects an action tag even when the tag looks versioned", async () => {
    expect((await inspectRepository(await fixture("floating-action", { actionRef: "v4" }))).errors.join("\n")).toMatch(/full commit SHA/);
  });

  it("rejects an unpinned service image", async () => {
    expect((await inspectRepository(await fixture("floating-image", { image: "postgres:17.6" }))).errors.join("\n")).toMatch(/sha256 digest/);
  });

  it("rejects an unpinned Compose image outside the workflow directory", async () => {
    const root = await fixture("floating-compose-image");
    await mkdir(path.join(root, "infra"), { recursive: true });
    await writeFile(path.join(root, "infra", "compose.yaml"), "services:\n  postgres:\n    image: postgres:17.11\n");
    expect((await inspectRepository(root)).errors.join("\n")).toMatch(/infra.*sha256 digest/);
  });

  it("rejects a fifth source workspace", async () => {
    const root = await fixture("workspace-count");
    await writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n");
    expect((await inspectRepository(root)).errors.join("\n")).toMatch(/exact four source workspaces/);
  });
});
