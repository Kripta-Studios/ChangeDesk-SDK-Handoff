import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EXPECTED_NODE = "v22.23.4";

function pnpmInvocation(args) {
  const corepack = path.join(path.dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js");
  return existsSync(corepack)
    ? { command: process.execPath, args: [corepack, "pnpm", ...args] }
    : { command: "pnpm", args };
}

export function verificationCommands() {
  return [
    { name: "repository pins", command: process.execPath, args: ["scripts/verify-locks.mjs"] },
    { name: "verification script tests", command: process.execPath, args: ["--test", "scripts/verify-locks.test.mjs"] },
    { name: "contract types", ...pnpmInvocation(["exec", "tsc", "-p", "packages/contracts/tsconfig.json", "--pretty", "false"]) },
    { name: "core test types", ...pnpmInvocation(["exec", "tsc", "-p", "tests/core/tsconfig.json", "--pretty", "false"]) },
    { name: "law test types", ...pnpmInvocation(["exec", "tsc", "-p", "tests/laws/tsconfig.json", "--pretty", "false"]) },
    { name: "deterministic core and law tests", ...pnpmInvocation(["exec", "vitest", "run", "tests/core", "tests/laws", "--config", "vitest.config.ts", "--reporter=dot"]) },
    { name: "whitespace errors", command: "git", args: ["diff", "--check", "HEAD"] }
  ];
}

export function runVerification(root = process.cwd()) {
  if (process.version !== EXPECTED_NODE) {
    process.stderr.write(`FAIL runtime version ${process.version}; expected ${EXPECTED_NODE}\n`);
    return 1;
  }
  for (const step of verificationCommands()) {
    process.stdout.write(`\n==> ${step.name}\n`);
    const result = spawnSync(step.command, step.args, { cwd: root, shell: false, stdio: "inherit" });
    if (result.error) {
      process.stderr.write(`FAIL ${step.name}: ${result.error.message}\n`);
      return 1;
    }
    if (result.status !== 0) {
      process.stderr.write(`FAIL ${step.name}: exit ${result.status}\n`);
      return result.status ?? 1;
    }
  }
  process.stdout.write("\nPASS deterministic CI verification\n");
  return 0;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = runVerification(path.resolve(process.argv[2] ?? "."));
}
