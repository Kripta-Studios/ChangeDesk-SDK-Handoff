import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function licenseExpression(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof value.type === "string" && value.type.trim()) return value.type.trim();
  if (Array.isArray(value)) {
    const expressions = value.map(licenseExpression).filter(Boolean);
    if (expressions.length > 0) return expressions.join(" OR ");
  }
  return undefined;
}

function packageSlug(name) {
  return name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
}

export function inventoryRecord(manifest, manifestSha256, override) {
  if (typeof manifest?.name !== "string" || typeof manifest?.version !== "string") throw new Error("Installed package is missing an exact name or version");
  const license = licenseExpression(manifest.license ?? manifest.licenses) ?? licenseExpression(override?.license);
  if (!license) throw new Error(`${manifest.name}@${manifest.version} is missing an attributable license`);
  const encodedName = encodeURIComponent(manifest.name);
  return {
    SPDXID: `SPDXRef-Package-${createHash("sha256").update(`${manifest.name}@${manifest.version}`).digest("hex").slice(0, 24)}`,
    name: manifest.name,
    versionInfo: manifest.version,
    downloadLocation: `https://registry.npmjs.org/${encodedName}/-/${packageSlug(manifest.name)}-${manifest.version}.tgz`,
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: license,
    copyrightText: "NOASSERTION",
    checksums: [{ algorithm: "SHA256", checksumValue: manifestSha256 }],
    comment: `SHA256 covers the installed package.json used to derive exact version and declared license.${override ? ` Reviewed license override: ${override.source}; scope: ${override.scopeEvidence}.` : ""}`,
    externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: `pkg:npm/${encodedName}@${manifest.version}` }]
  };
}

async function packageJsonFiles(root) {
  const store = path.join(root, "node_modules", ".pnpm");
  if (!existsSync(store)) throw new Error("BLOCKED inventory: frozen pnpm installation is required");
  const files = [];
  for (const entry of await readdir(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const modules = path.join(store, entry.name, "node_modules");
    if (!existsSync(modules)) continue;
    for (const child of await readdir(modules, { withFileTypes: true })) {
      if (!child.isDirectory() && !child.isSymbolicLink()) continue;
      if (child.name.startsWith("@")) {
        const scope = path.join(modules, child.name);
        for (const scoped of await readdir(scope, { withFileTypes: true }).catch(() => [])) {
          const candidate = path.join(scope, scoped.name, "package.json");
          if (existsSync(candidate)) files.push(candidate);
        }
      } else {
        const candidate = path.join(modules, child.name, "package.json");
        if (existsSync(candidate)) files.push(candidate);
      }
    }
  }
  return [...new Set(files)];
}

export async function createInventory(root) {
  const records = new Map();
  const missingLicenses = [];
  const overrideFile = path.join(root, ".github", "dependency-license-overrides.json");
  const overrides = existsSync(overrideFile) ? JSON.parse(await readFile(overrideFile, "utf8")).packages ?? {} : {};
  for (const filename of await packageJsonFiles(root)) {
    const bytes = await readFile(filename);
    const manifest = JSON.parse(bytes.toString("utf8"));
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") continue;
    const key = `${manifest.name}@${manifest.version}`;
    if (!records.has(key)) {
      try { records.set(key, inventoryRecord(manifest, createHash("sha256").update(bytes).digest("hex"), overrides[key])); }
      catch (error) {
        if (error instanceof Error && /license/.test(error.message)) missingLicenses.push(key);
        else throw error;
      }
    }
  }
  if (missingLicenses.length > 0) throw new Error(`Installed packages missing attributable licenses: ${[...new Set(missingLicenses)].sort().join(", ")}`);
  const packages = [...records.values()].sort((left, right) => `${left.name}@${left.versionInfo}`.localeCompare(`${right.name}@${right.versionInfo}`));
  if (packages.length === 0) throw new Error("BLOCKED inventory: no installed packages found");
  const revision = process.env.GITHUB_SHA ?? "local-working-tree";
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "changedesk-sdk-installed-dependencies",
    documentNamespace: `https://changedesk.invalid/sbom/${revision}/${createHash("sha256").update(packages.map((item) => `${item.name}@${item.versionInfo}`).join("\n")).digest("hex")}`,
    creationInfo: { created: new Date().toISOString(), creators: ["Tool: ChangeDesk verify-inventory.mjs"] },
    documentDescribes: packages.map((item) => item.SPDXID),
    packages
  };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const inventory = await createInventory(root);
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0) {
    const output = path.resolve(root, process.argv[outputIndex + 1] ?? "");
    const evidenceRoot = path.join(root, "evidence") + path.sep;
    if (!output.startsWith(evidenceRoot)) throw new Error("Inventory output must be inside evidence/");
    await writeFile(output, `${JSON.stringify(inventory, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
  process.stdout.write(`PASS SPDX inventory ${inventory.packages.length} exact installed package versions with declared licenses\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
