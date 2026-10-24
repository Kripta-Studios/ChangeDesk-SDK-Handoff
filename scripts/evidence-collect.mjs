import { copyFile, lstat, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ALLOWED_EXTENSIONS = new Set([".json", ".xml", ".md", ".txt"]);
const MAX_INPUT_BYTES = 5 * 1024 * 1024;

export async function collectEvidence({ runDirectory, manifest, acceptance, artifacts = [] }) {
  const target = resolve(runDirectory);
  await mkdir(join(target, "results"), { recursive: true });
  await writeFile(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  await writeFile(join(target, "acceptance.json"), `${JSON.stringify(acceptance, null, 2)}\n`, { flag: "wx" });
  for (const artifact of artifacts) {
    const source = resolve(artifact);
    const stat = await lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INPUT_BYTES || !ALLOWED_EXTENSIONS.has(extname(source).toLowerCase())) throw new Error(`artifact rejected: ${basename(source)}`);
    await copyFile(source, join(target, "results", basename(source)), 1);
  }
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.error("evidence-collect.mjs is a library entrypoint; call collectEvidence with an explicit run directory and structured manifest");
  process.exitCode = 2;
}
