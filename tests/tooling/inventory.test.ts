import { describe, expect, it } from "vitest";

// @ts-expect-error Executable tooling intentionally has no declaration bundle.
import { inventoryRecord } from "../../scripts/verify-inventory.mjs";

describe("dependency inventory", () => {
  it("binds exact package version, declared license and official registry source", () => {
    expect(inventoryRecord({ name: "@scope/example", version: "1.2.3", license: "MIT" }, "a".repeat(64))).toMatchObject({
      SPDXID: expect.stringMatching(/^SPDXRef-Package-/),
      name: "@scope/example",
      versionInfo: "1.2.3",
      licenseDeclared: "MIT",
      downloadLocation: "https://registry.npmjs.org/%40scope%2Fexample/-/example-1.2.3.tgz",
      checksums: [{ algorithm: "SHA256", checksumValue: "a".repeat(64) }]
    });
  });

  it("rejects installed dependencies without an attributable license", () => {
    expect(() => inventoryRecord({ name: "mystery", version: "1.0.0" }, "b".repeat(64))).toThrow(/license/);
  });

  it("records the reviewed source when package metadata needs a license override", () => {
    const record = inventoryRecord({ name: "mystery", version: "1.0.0" }, "b".repeat(64), { license: "MIT", source: "https://example.test/LICENSE", scopeEvidence: "https://example.test/package.json" });
    expect(record.licenseDeclared).toBe("MIT");
    expect(record.comment).toContain("Reviewed license override: https://example.test/LICENSE");
  });
});
