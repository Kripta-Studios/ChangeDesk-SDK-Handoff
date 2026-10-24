import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyEvidenceDirectory } from "../../scripts/evidence-verify.mjs";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "changedesk-evidence-"));
  await mkdir(join(root, "results"));
  await writeFile(join(root, "manifest.json"), JSON.stringify({ schemaVersion: "1", runId: "security-test", commands: [{ command: "vitest", exitCode: 1 }] }));
  await writeFile(join(root, "acceptance.json"), JSON.stringify({ criteria: [{ id: "ACC-013", status: "FAIL", evidence: ["results/security.json"] }] }));
  await writeFile(join(root, "results", "security.json"), JSON.stringify({ status: "FAIL" }));
  return root;
}

describe("ACC-017 evidence verification", () => {
  it("preserves diagnostic FAIL under ci-local but rejects it for release", async () => {
    const root = await fixture();
    await expect(verifyEvidenceDirectory(root, "ci-local")).resolves.toMatchObject({ valid: true });
    await expect(verifyEvidenceDirectory(root, "release")).resolves.toMatchObject({ valid: false, errors: expect.arrayContaining([expect.stringMatching(/ACC-013.*FAIL/)]) });
  });
  it("rejects PASS claims with missing evidence and secret-shaped content", async () => {
    const root = await fixture();
    await writeFile(join(root, "acceptance.json"), JSON.stringify({ criteria: [{ id: "ACC-013", status: "PASS", evidence: ["results/missing.json"] }] }));
    await writeFile(join(root, "results", "security.json"), "Authorization: Bearer secret-value");
    const result = await verifyEvidenceDirectory(root, "ci-local");
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/missing evidence/i), expect.stringMatching(/secret/i)]));
  });
});
