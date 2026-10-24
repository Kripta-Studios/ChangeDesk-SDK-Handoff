import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BendLawVerifier } from "../../apps/service/src/laws/bend-verifier.js";

const binaryPath = process.env.CHANGEDESK_BEND_BINARY_WINDOWS ?? resolve("..", "environment", ".tools", "bend-2.0.39-linux-x64", "bend", "bin", "bend");
const executionBinaryPath = process.env.CHANGEDESK_BEND_BINARY_LINUX ?? (() => {
  const match = /^([A-Za-z]):\\(.*)$/u.exec(binaryPath);
  return match ? `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replaceAll("\\", "/")}` : "missing";
})();
const bendttPath = process.env.CHANGEDESK_BENDTT_LINUX;
const binaryAvailable = existsSync(binaryPath);
const kernelAvailable = existsSync(binaryPath) && Boolean(bendttPath);

describe("real Bend v2.0.39 verifier", () => {
  it("kernel-verifies the reviewed campaign laws", async () => {
    const verifier = new BendLawVerifier({
      binaryPath,
      expectedBinarySha256: "2ec160fa4486d33aff51e9eedcc294d6b531dc10c279c00b0c00685dae2045cd",
      executionBinaryPath,
      reviewedSourceDir: resolve("apps/service/src/laws/bend"),
      timeoutMs: 60_000,
      maxOutputBytes: 64_000,
      ...(bendttPath ? { bendttPath } : {}),
    });
    const result = await verifier.verify({ artifactHash: "a".repeat(64), planHash: "b".repeat(64), policyVersion: "1", scope: "catalog.campaign.prepare.v1" });
    expect(result.status).toBe(kernelAvailable ? "verified" : "unavailable");
  }, 70_000);

  it("rejects the fixed false-law mutant with the real kernel", async () => {
    const verifier = new BendLawVerifier({
      binaryPath,
      expectedBinarySha256: "2ec160fa4486d33aff51e9eedcc294d6b531dc10c279c00b0c00685dae2045cd",
      executionBinaryPath,
      reviewedSourceDir: resolve("tests/laws/fixtures/false-law"),
      timeoutMs: 60_000,
      maxOutputBytes: 64_000,
      ...(bendttPath ? { bendttPath } : {}),
    });
    const result = await verifier.verify({ artifactHash: "a".repeat(64), planHash: "b".repeat(64), policyVersion: "1", scope: "false-law-mutant" });
    expect(result.status).toBe(binaryAvailable ? "failed" : "unavailable");
  }, 70_000);
});
