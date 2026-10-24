import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SOURCE_WORKSPACES = [
  "apps/service",
  "packages/contracts",
  "packages/sdk-react",
  "packages/medusa-plugin"
];
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const DIGEST_IMAGE = /^[^\s]+@sha256:[0-9a-f]{64}$/;

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function workflowFiles(root) {
  const directory = path.join(root, ".github", "workflows");
  if (!existsSync(directory)) return [];
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name));
}

async function pinPolicyFiles(root) {
  const files = await workflowFiles(root);
  for (const relativeName of ["infra/compose.yaml", "infra/compose.yml", "compose.yaml", "compose.yml"]) {
    const filename = path.join(root, relativeName);
    if (existsSync(filename)) files.push(filename);
  }
  return files;
}

function parseWorkspacePaths(source) {
  const result = [];
  let inPackages = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line)) break;
    const item = inPackages ? /^\s+-\s+([^#]+?)\s*$/.exec(line)?.[1] : undefined;
    if (item) result.push(item.replace(/^['"]|['"]$/g, ""));
  }
  return result;
}

function inspectManifest(manifest, relativeName, errors) {
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      const internal = typeof version === "string" && version === "workspace:*";
      if (!internal && (typeof version !== "string" || !EXACT_VERSION.test(version))) {
        errors.push(`${relativeName}: floating dependency ${field}.${name}=${JSON.stringify(version)}`);
      }
    }
  }
}

function inspectWorkflow(source, relativeName, actionLocks, errors) {
  if (/\b(?:TODO|FIXME|CHANGEME)\b|<\s*(?:pin|digest|sha|command|replace)[^>]*>/i.test(source)) {
    errors.push(`${relativeName}: unresolved placeholder in active workflow`);
  }
  for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*$/gm)) {
    const target = match[1];
    if (target.startsWith("./")) continue;
    const separator = target.lastIndexOf("@");
    const action = separator >= 0 ? target.slice(0, separator) : target;
    const reference = separator >= 0 ? target.slice(separator + 1) : "";
    if (!FULL_SHA.test(reference)) errors.push(`${relativeName}: action ${target} must use a full commit SHA`);
    else if (actionLocks?.[action]?.commit !== reference) errors.push(`${relativeName}: action ${action} is absent or differs in .github/actions-lock.json`);
  }
  for (const match of source.matchAll(/^\s*image:\s*([^\s#]+)\s*$/gm)) {
    if (!DIGEST_IMAGE.test(match[1])) errors.push(`${relativeName}: image ${match[1]} must use a sha256 digest`);
  }
}

export async function inspectRepository(root) {
  const errors = [];
  const workspaceFile = path.join(root, "pnpm-workspace.yaml");
  const lockFile = path.join(root, "pnpm-lock.yaml");
  if (!existsSync(workspaceFile)) errors.push("pnpm-workspace.yaml: missing");
  if (!existsSync(lockFile)) errors.push("pnpm-lock.yaml: missing");

  if (existsSync(workspaceFile)) {
    const actual = parseWorkspacePaths(await readFile(workspaceFile, "utf8"));
    if (actual.length !== SOURCE_WORKSPACES.length || actual.some((item, index) => item !== SOURCE_WORKSPACES[index])) {
      errors.push(`pnpm-workspace.yaml: expected exact four source workspaces (${SOURCE_WORKSPACES.join(", ")})`);
    }
  }

  const manifests = ["package.json", ...SOURCE_WORKSPACES.map((workspace) => `${workspace}/package.json`)];
  for (const relativeName of manifests) {
    const filename = path.join(root, relativeName);
    if (!existsSync(filename)) {
      errors.push(`${relativeName}: missing source workspace manifest`);
      continue;
    }
    try {
      inspectManifest(await readJson(filename), relativeName, errors);
    } catch (error) {
      errors.push(`${relativeName}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  let actionLocks;
  const actionsLockFile = path.join(root, ".github", "actions-lock.json");
  if (existsSync(actionsLockFile)) {
    try {
      actionLocks = (await readJson(actionsLockFile)).actions;
    } catch (error) {
      errors.push(`.github/actions-lock.json: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  for (const filename of await pinPolicyFiles(root)) {
    inspectWorkflow(await readFile(filename, "utf8"), path.relative(root, filename), actionLocks, errors);
  }
  return { errors };
}

function verifyFrozenLock(root) {
  const corepack = path.join(path.dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js");
  const executable = existsSync(corepack) ? process.execPath : "pnpm";
  const args = existsSync(corepack)
    ? [corepack, "pnpm", "install", "--lockfile-only", "--frozen-lockfile", "--ignore-scripts"]
    : ["install", "--lockfile-only", "--frozen-lockfile", "--ignore-scripts"];
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    stdio: "pipe"
  });
  if (result.error) return [`pnpm frozen-lockfile check could not start: ${result.error.message}`];
  if (result.status !== 0) return [`pnpm frozen-lockfile check failed (${result.status}): ${(result.stderr || result.stdout).trim()}`];
  return [];
}

async function main() {
  const root = path.resolve(process.argv[2] ?? ".");
  const result = await inspectRepository(root);
  result.errors.push(...verifyFrozenLock(root));
  if (result.errors.length > 0) {
    for (const error of result.errors) process.stderr.write(`ERROR ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("PASS lock, dependency, workspace, action and image pins verified\n");
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
