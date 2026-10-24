import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { migrationChecksum } from "../../src/storage/migrations.js";

describe("migration checksum portability", () => {
  it("normalizes checkout line endings but detects semantic SQL changes", () => {
    expect(migrationChecksum("SELECT 1;\nSELECT 2;\n")).toBe(migrationChecksum("SELECT 1;\r\nSELECT 2;\r\n"));
    expect(migrationChecksum("SELECT 1;\nSELECT 2;\n")).not.toBe(migrationChecksum("SELECT 1;\nSELECT 3;\n"));
  });

  it("recovers capacity leases by the exact expired job identity under the scheduler lock", async () => {
    const sql = await readFile(new URL("../../migrations/015_capacity_lease_reclaim.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\('changedesk\.scheduler\.capacity\.v1'\)\)/u);
    expect(sql).toMatch(/DELETE FROM storage\.capacity_leases[\s\S]*job_id=ANY\(recovered_ids\)/u);
    expect(sql).toMatch(/status='leased' AND lease_until<=clock_timestamp\(\)/u);
  });
});
