import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationsUrl = new URL("../../apps/service/migrations/", import.meta.url);

async function migrationSql() {
  const files = (await readdir(migrationsUrl)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  return (await Promise.all(files.map((name) => readFile(new URL(name, migrationsUrl), "utf8")))).join("\n");
}

describe("storage migration source invariants",()=>{
it("storage schema forces RLS on every tenant-scoped table", async () => {
  const sql = await migrationSql();
  const tenantTables = [
    "host_connections",
    "actors",
    "requests",
    "request_messages",
    "installations",
    "plans",
    "approvals",
    "executions",
    "execution_rows",
    "step_attempts",
    "jobs",
    "idempotency_records",
    "session_tickets",
    "sessions",
    "audit_events",
    "signing_key_secrets",
    "capability_manifests",
  ];

  for (const table of tenantTables) {
    expect(sql).toMatch(new RegExp(`ALTER TABLE storage\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
    expect(sql).toMatch(new RegExp(`ALTER TABLE storage\\.${table} FORCE ROW LEVEL SECURITY`, "i"));
  }
});

it("storage schema enforces business uniqueness separately from HTTP idempotency", async () => {
  const sql = await migrationSql();
  expect(sql).toMatch(/UNIQUE\s*\(tenant_id,\s*plan_id,\s*plan_version,\s*actor_id\)/i);
  expect(sql).toMatch(/UNIQUE\s*\(tenant_id,\s*plan_id,\s*plan_version\)/i);
  expect(sql).toMatch(/PRIMARY KEY\s*\(tenant_id,\s*actor_id,\s*operation,\s*key\)/i);
});

it("tenant child references are composite and ticket nonce replay is impossible", async () => {
  const sql = await migrationSql();
  expect(sql).toMatch(/FOREIGN KEY\s*\(tenant_id,\s*plan_id,\s*plan_version\)[\s\S]*?REFERENCES storage\.plans\s*\(tenant_id,\s*id,\s*plan_version\)/i);
  expect(sql).toMatch(/FOREIGN KEY\s*\(tenant_id,\s*execution_id\)[\s\S]*?REFERENCES storage\.executions\s*\(tenant_id,\s*id\)/i);
  expect(sql).toMatch(/CREATE TABLE storage\.session_tickets[\s\S]*?nonce_hash text NOT NULL[\s\S]*?UNIQUE\s*\(tenant_id,\s*nonce_hash\)/i);
  expect(sql).toMatch(/consumed_at timestamptz/i);
});

it("scheduler functions fence writes and expose only job scheduling metadata", async () => {
  const sql = await migrationSql();
  expect(sql).toMatch(/CREATE FUNCTION storage\.claim_next_job/i);
  expect(sql).toMatch(/CREATE FUNCTION storage\.heartbeat_job/i);
  expect(sql).toMatch(/CREATE FUNCTION storage\.finish_job/i);
  expect(sql).toMatch(/lease_owner\s*=\s*p_worker_id[\s\S]*?fence\s*=\s*p_fence/i);
  expect(sql).toMatch(/SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, storage/i);
  expect(sql).not.toMatch(/GRANT\s+SELECT\s+ON\s+ALL TABLES[^;]*changedesk_worker/i);
});
});
