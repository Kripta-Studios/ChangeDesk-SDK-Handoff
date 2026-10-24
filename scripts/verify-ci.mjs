import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EXPECTED_NODE = "v22.23.4";

export function verificationCommands(lane = "deterministic") {
  const deterministic = [
    { name: "repository pins", command: process.execPath, args: ["scripts/verify-locks.mjs"] },
    { name: "contract types", command: process.execPath, args: ["node_modules/typescript/bin/tsc", "-p", "packages/contracts/tsconfig.json", "--pretty", "false"] },
    { name: "core test types", command: process.execPath, args: ["node_modules/typescript/bin/tsc", "-p", "tests/core/tsconfig.json", "--pretty", "false"] },
    { name: "law test types", command: process.execPath, args: ["node_modules/typescript/bin/tsc", "-p", "tests/laws/tsconfig.json", "--pretty", "false"] },
    { name: "deterministic core, law and tooling tests", command: process.execPath, args: ["node_modules/vitest/vitest.mjs", "run", "tests/core", "tests/laws/model.test.ts", "tests/laws/verdict.test.ts", "tests/laws/bend-verifier.test.ts", "tests/tooling", "--config", "vitest.config.ts", "--reporter=dot"] },
    { name: "whitespace errors", command: "git", args: ["diff", "--check", "HEAD"] }
  ];
  const lanes = {
    deterministic,
    build: [
      { name: "build contracts", command: process.execPath, args: ["node_modules/typescript/bin/tsc", "-b", "packages/contracts", "--force", "--pretty", "false"] },
      { name: "build service", command: process.execPath, args: ["node_modules/typescript/bin/tsc", "-p", "apps/service/tsconfig.json", "--pretty", "false"] },
      { name: "build SDK JavaScript", command: process.execPath, args: ["../../node_modules/vite/bin/vite.js", "build"], cwd: "packages/sdk-react" },
      { name: "build SDK declarations", command: process.execPath, args: ["../../node_modules/typescript/bin/tsc", "-b", ".", "--force", "--pretty", "false"], cwd: "packages/sdk-react" },
      { name: "build Medusa plugin", command: process.execPath, args: ["node_modules/@medusajs/cli/cli.js", "plugin:build"], cwd: "packages/medusa-plugin", env: { MEDUSA_DISABLE_TELEMETRY: "true", MEDUSA_FF_ANALYTICS: "false" } }
    ],
    unit: [
      { name: "unit SDK runtime and Medusa bridge", command: process.execPath, args: ["node_modules/vitest/vitest.mjs", "run", "tests/sdk", "apps/service/tests/runtime", "tests/medusa/bridge-contract.test.ts", "tests/medusa/native-guard.test.ts", "--config", "vitest.config.ts", "--reporter=dot"] }
    ],
    functional: [
      { name: "functional storefront, planner and backend security", command: process.execPath, args: [
        "node_modules/vitest/vitest.mjs", "run",
        "tests/storefront", "tests/recovery", "tests/medusa/storefront-logout-middleware.test.ts",
        "tests/planner/bootstrap.test.ts", "tests/planner/catalog.test.ts", "tests/planner/generation-worker.test.ts", "tests/planner/planner.test.ts", "tests/planner/providers.test.ts",
        "tests/security/actual-fastify-attacks.test.ts", "tests/security/attack-corpus.test.ts", "tests/security/backend-effect-oracle.test.ts", "tests/security/change-impact.test.ts", "tests/security/coverage-report.test.ts", "tests/security/paired-metrics.test.ts",
        "--config", "vitest.config.ts", "--reporter=dot"
      ] }
    ],
    postgres: [
      { name: "PostgreSQL storage and runtime integration", command: process.execPath, args: ["node_modules/vitest/vitest.mjs", "run", "tests/storage/store.integration.test.ts", "tests/runtime/real-pg-vertical.integration.test.ts", "tests/security/storage-operations-adversarial.integration.test.ts", "tests/planner/catalog.pg.integration.test.ts", "--config", "vitest.config.ts", "--reporter=dot", "--no-file-parallelism"] }
    ],
    medusa: [
      { name: "Medusa official integration runner", command: process.execPath, args: ["../../node_modules/jest/bin/jest.js", "--config", "jest.config.cjs", "--runInBand", "--forceExit"], cwd: "examples/medusa" }
    ],
    browser: [
      { name: "browser Atlas and Boreal E2E", command: process.execPath, args: ["node_modules/@playwright/test/cli.js", "test", "tests/e2e/changedesk.spec.ts", "--reporter=line"] }
    ],
    inventory: [
      { name: "inventory SPDX SBOM", command: process.execPath, args: ["scripts/verify-inventory.mjs", "--check"] }
    ]
  };
  const selected = lanes[lane];
  if (!selected) throw new Error(`Unknown verification lane: ${lane}`);
  return selected;
}

export function validatePostgresEnvironment(environment = process.env) {
  const names = ["CHANGEDESK_MIGRATOR_DATABASE_URL", "CHANGEDESK_RUNTIME_DATABASE_URL", "CHANGEDESK_WORKER_DATABASE_URL"];
  const missing = names.filter((name) => !environment[name]);
  if (missing.length > 0) throw new Error(`BLOCKED postgres: missing ${missing.join(", ")}`);
  const scope = environment.CHANGEDESK_INTEGRATION_DATABASE_SCOPE;
  if (!scope || !/^changedesk_test_[a-z0-9_]+$/.test(scope)) throw new Error("BLOCKED postgres: an explicit run-scoped changedesk_test_<run> database is required");
  for (const name of names) {
    let database;
    try { database = new URL(environment[name]).pathname.slice(1); } catch { throw new Error(`BLOCKED postgres: invalid ${name}`); }
    if (database !== scope) throw new Error(`BLOCKED postgres: ${name} must target the run-scoped ${scope} database`);
  }
}

function assertLanePreconditions(lane, root) {
  if (lane === "postgres") validatePostgresEnvironment();
  const requiredEnvironment = lane === "medusa" ? ["DATABASE_URL"] : [];
  const missing = requiredEnvironment.filter((name) => !process.env[name]);
  if (missing.length > 0) throw new Error(`BLOCKED ${lane}: missing ${missing.join(", ")}`);
  if (lane === "browser") {
    for (const relative of ["examples/medusa/.local/credentials.atlas.json", "examples/medusa/.local/credentials.boreal.json", "evidence/local/seed-map.atlas.json", "evidence/local/seed-map.boreal.json"]) {
      if (!existsSync(path.join(root, relative))) throw new Error(`BLOCKED browser: missing private fixture ${relative}`);
    }
  }
}

export function runVerification(root = process.cwd(), lane = "deterministic") {
  if (process.version !== EXPECTED_NODE) {
    process.stderr.write(`FAIL runtime version ${process.version}; expected ${EXPECTED_NODE}\n`);
    return 1;
  }
  try { assertLanePreconditions(lane, root); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); return 2; }
  for (const step of verificationCommands(lane)) {
    process.stdout.write(`\n==> ${step.name}\n`);
    const result = spawnSync(step.command, step.args, { cwd: path.resolve(root, step.cwd ?? "."), env: { ...process.env, ...step.env }, shell: false, stdio: "inherit" });
    if (result.error) {
      process.stderr.write(`FAIL ${step.name}: ${result.error.message}\n`);
      return 1;
    }
    if (result.status !== 0) {
      process.stderr.write(`FAIL ${step.name}: exit ${result.status}\n`);
      return result.status ?? 1;
    }
  }
  process.stdout.write(`\nPASS ${lane} CI verification\n`);
  return 0;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const laneIndex = process.argv.indexOf("--lane");
  const lane = laneIndex >= 0 ? process.argv[laneIndex + 1] : "deterministic";
  if (!lane) throw new Error("--lane requires a value");
  process.exitCode = runVerification(process.cwd(), lane);
}
