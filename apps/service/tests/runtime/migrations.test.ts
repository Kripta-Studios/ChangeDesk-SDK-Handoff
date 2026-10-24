import { describe, expect, it } from "vitest";
import { migrationChecksum } from "../../src/storage/migrations.js";

describe("migration checksum portability", () => {
  it("normalizes checkout line endings but detects semantic SQL changes", () => {
    expect(migrationChecksum("SELECT 1;\nSELECT 2;\n")).toBe(migrationChecksum("SELECT 1;\r\nSELECT 2;\r\n"));
    expect(migrationChecksum("SELECT 1;\nSELECT 2;\n")).not.toBe(migrationChecksum("SELECT 1;\nSELECT 3;\n"));
  });
});
