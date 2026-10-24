import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BendLawVerifier, type BendVerifierConfig } from "../../apps/service/src/laws/bend-verifier.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`BLOCKED: ${name} is required for the explicit live Bend kernel lane`);
  return value;
}

const common = {
  binaryPath: requiredEnvironment("CHANGEDESK_BEND_BINARY_WINDOWS"),
  executionBinaryPath: requiredEnvironment("CHANGEDESK_BEND_BINARY_LINUX"),
  bendttPath: requiredEnvironment("CHANGEDESK_BENDTT_LINUX"),
  expectedBinarySha256: "2ec160fa4486d33aff51e9eedcc294d6b531dc10c279c00b0c00685dae2045cd",
  workspaceRoot: resolve("."),
  workspaceTempRoot: resolve(".tools", "bend-verifier-tmp"),
  timeoutMs: 60_000,
  maxOutputBytes: 64_000,
} as const;

const verifier = (source: Pick<BendVerifierConfig, "reviewedSourceDir" | "expectedModelSha256" | "expectedLawsSha256" | "expectedProofSha256">): BendLawVerifier =>
  new BendLawVerifier({ ...common, ...source });

describe("explicit live Bend v2.0.39 kernel lane", () => {
  it("kernel-verifies the reviewed campaign laws", async () => {
    const result = await verifier({
      reviewedSourceDir: resolve("apps/service/src/laws/bend"),
      expectedModelSha256: "ac9d10d08692f9259301edf9d897ddb782eb403b98f1fbeff13b9e987baa1596",
      expectedLawsSha256: "02584a23199db88ec67974a4e458a0e7f16f8ed9196b8c1ba5b0a08cfa6937ac",
      expectedProofSha256: "827e041bc627ff9db7416e9f7f25693e08a170c9d1146330a4c9221c40a344ae",
    }).verify({ artifactHash: "a".repeat(64), planHash: "b".repeat(64), policyVersion: "1", scope: "catalog.campaign.prepare.v1" });
    expect(result.status).toBe("verified");
    expect(result.toolchainHash).toMatch(/^[a-f0-9]{64}$/u);
  }, 70_000);

  it("kernel-rejects the fixed false-law mutant", async () => {
    const result = await verifier({
      reviewedSourceDir: resolve("tests/laws/fixtures/false-law"),
      expectedModelSha256: "7043898d06cbd035fa4d30694e2d154966c69e8babf180075737471b82919991",
      expectedLawsSha256: "608c932b5095d72dd582dbafaa35ab2a89cfef96cbb1e62f473fb721a4971678",
      expectedProofSha256: "ef5b0596fab7c3b6172accfb5f0f26585a74f17309eab1cd78111187945df662",
    }).verify({ artifactHash: "a".repeat(64), planHash: "b".repeat(64), policyVersion: "1", scope: "false-law-mutant" });
    expect(result.status).toBe("failed");
  }, 70_000);
});
