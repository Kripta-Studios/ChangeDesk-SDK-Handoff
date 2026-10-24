import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ALLOWED_TOP_LEVEL = new Set(["manifest.json", "acceptance.json", "review.md", "results", "state", "metrics", "ui"]);
const STATUSES = new Set(["PASS", "FAIL", "BLOCKED", "NOT_RUN", "NOT_APPLICABLE"]);
const PERFORMANCE_EXCLUSION_REFERENCE = "docs/14-IMPLEMENTATION-DECISIONS.md#adr-012";
const SECRET_PATTERNS = [
  /Authorization\s*:\s*Bearer\s+\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|client[_-]?secret|password)\s*[=:]\s*["']?[A-Za-z0-9_\-./+=]{8,}/i,
];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

async function filesUnder(root) {
  const found = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) { found.push({ path, symlink: true }); continue; }
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) found.push({ path, symlink: false });
    }
  }
  await visit(root);
  return found;
}
const isContained = (root, candidate) => { const rel = relative(root, candidate); return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel); };

export async function verifyEvidenceDirectory(directory, profile = "ci-local") {
  const errors = [];
  if (profile !== "ci-local" && profile !== "release") return { valid: false, errors: [`unknown profile ${profile}`] };
  const root = await realpath(resolve(directory));
  let manifest;
  let acceptance;
  try { manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")); } catch { errors.push("manifest.json missing or invalid"); }
  try { acceptance = JSON.parse(await readFile(join(root, "acceptance.json"), "utf8")); } catch { errors.push("acceptance.json missing or invalid"); }
  const files = await filesUnder(root);
  for (const item of files) {
    const rel = relative(root, item.path).replaceAll("\\", "/");
    if (!ALLOWED_TOP_LEVEL.has(rel.split("/")[0])) errors.push(`file is not allowlisted: ${rel}`);
    if (item.symlink) { errors.push(`symlink is forbidden: ${rel}`); continue; }
    const stat = await lstat(item.path);
    if (stat.size > MAX_FILE_BYTES) { errors.push(`file exceeds size limit: ${rel}`); continue; }
    const content = await readFile(item.path, "utf8");
    if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) errors.push(`secret-shaped content found: ${rel}`);
  }
  if (!manifest || typeof manifest.runId !== "string" || !Array.isArray(manifest.commands)) errors.push("manifest lacks runId or commands");
  const criteria = acceptance?.criteria;
  if (!Array.isArray(criteria)) errors.push("acceptance criteria missing");
  else for (const criterion of criteria) {
    const isExplicitPerformanceExclusion = criterion?.id === "ACC-015" &&
      criterion?.status === "NOT_APPLICABLE" &&
      Array.isArray(criterion?.evidence) && criterion.evidence.includes(PERFORMANCE_EXCLUSION_REFERENCE) &&
      typeof criterion?.note === "string" && /explicit user exclusion.*performance/i.test(criterion.note);
    if (typeof criterion?.id !== "string" || !/^ACC-\d{3}$/.test(criterion.id) || !STATUSES.has(criterion.status)) { errors.push("acceptance criterion has invalid id/status"); continue; }
    if (!Array.isArray(criterion.evidence) || criterion.evidence.length === 0) errors.push(`${criterion.id} has no evidence references`);
    else for (const reference of criterion.evidence) {
      if (typeof reference !== "string") { errors.push(`${criterion.id} evidence reference is invalid`); continue; }
      if (isExplicitPerformanceExclusion && reference === PERFORMANCE_EXCLUSION_REFERENCE) continue;
      const target = resolve(root, reference);
      if (!isContained(root, target)) { errors.push(`${criterion.id} evidence escapes run directory`); continue; }
      try { if (!(await lstat(target)).isFile()) throw new Error(); } catch { errors.push(`${criterion.id} missing evidence: ${reference}`); }
    }
    if (profile === "release" && criterion.status !== "PASS" && !isExplicitPerformanceExclusion) errors.push(`${criterion.id} is ${criterion.status}, release requires PASS except the explicit ACC-015/ADR-012 exclusion`);
  }
  return { valid: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  const profile = process.argv.find((arg) => arg.startsWith("--profile="))?.slice("--profile=".length) ?? "ci-local";
  if (!directory) { console.error("usage: node scripts/evidence-verify.mjs <run-directory> [--profile=ci-local|release]"); process.exitCode = 2; }
  else { const result = await verifyEvidenceDirectory(directory, profile); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.valid ? 0 : 1; }
}
