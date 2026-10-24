import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BendLawVerifier } from "../../apps/service/src/laws/bend-verifier.js";

describe("Bend adapter availability", () => {
  it("reports unavailable rather than verified when the pinned binary is absent", async () => {
    const binaryPath = resolve(".tools", "missing-bend", "bend");
    const executionBinaryPath = `/mnt/${binaryPath[0]!.toLowerCase()}${binaryPath.slice(2).replaceAll("\\", "/")}`;
    const verifier = new BendLawVerifier({
      binaryPath,
      executionBinaryPath,
      expectedBinarySha256: "2ec160fa4486d33aff51e9eedcc294d6b531dc10c279c00b0c00685dae2045cd",
      reviewedSourceDir: resolve("apps/service/src/laws/bend"),
      expectedModelSha256: "ac9d10d08692f9259301edf9d897ddb782eb403b98f1fbeff13b9e987baa1596",
      expectedLawsSha256: "02584a23199db88ec67974a4e458a0e7f16f8ed9196b8c1ba5b0a08cfa6937ac",
      expectedProofSha256: "827e041bc627ff9db7416e9f7f25693e08a170c9d1146330a4c9221c40a344ae",
      workspaceRoot: resolve("."),
      workspaceTempRoot: resolve(".tools", "bend-verifier-tmp"),
      timeoutMs: 1_000,
      maxOutputBytes: 4_000,
    });
    const result = await verifier.verify({ artifactHash: "a".repeat(64), planHash: "b".repeat(64), policyVersion: "1", scope: "unit-unavailable" });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("verifier_setup_unavailable");
  });
});
