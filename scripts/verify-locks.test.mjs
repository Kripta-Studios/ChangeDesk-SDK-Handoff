import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { inspectRepository } from "./verify-locks.mjs";

async function fixture(name, { version = "1.2.3", actionRef = "a".repeat(40), image = "postgres@sha256:" + "b".repeat(64) } = {}) {
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
  await writeFile(path.join(root, ".github", "actions-lock.json"), JSON.stringify({
    actions: { "actions/checkout": { commit: actionRef } }
  }));
  return root;
}

test("accepts exact dependency, action, image and workspace pins", async () => {
  const root = await fixture("valid");
  assert.deepEqual((await inspectRepository(root)).errors, []);
});

test("rejects floating dependency versions", async () => {
  const root = await fixture("floating-dependency", { version: "^1.2.3" });
  assert.match((await inspectRepository(root)).errors.join("\n"), /floating dependency/);
});

test("rejects an action tag even when the tag looks versioned", async () => {
  const root = await fixture("floating-action", { actionRef: "v4" });
  assert.match((await inspectRepository(root)).errors.join("\n"), /full commit SHA/);
});

test("rejects an unpinned service image", async () => {
  const root = await fixture("floating-image", { image: "postgres:17.6" });
  assert.match((await inspectRepository(root)).errors.join("\n"), /sha256 digest/);
});

test("rejects a fifth source workspace", async () => {
  const root = await fixture("workspace-count");
  await writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n");
  assert.match((await inspectRepository(root)).errors.join("\n"), /exact four source workspaces/);
});
