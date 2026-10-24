import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsUrl = new URL("../../apps/service/migrations/", import.meta.url);

async function migrationSql() {
  const files = (await readdir(migrationsUrl)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  return (await Promise.all(files.map((name) => readFile(new URL(name, migrationsUrl), "utf8")))).join("\n");
}

test("storage schema forces RLS on every tenant-scoped table", async () => {
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
  ];

  for (const table of tenantTables) {
    assert.match(sql, new RegExp(`ALTER TABLE storage\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE storage\\.${table} FORCE ROW LEVEL SECURITY`, "i"));
  }
});

test("storage schema enforces business uniqueness separately from HTTP idempotency", async () => {
  const sql = await migrationSql();
  assert.match(sql, /UNIQUE\s*\(tenant_id,\s*plan_id,\s*plan_version,\s*actor_id\)/i);
  assert.match(sql, /UNIQUE\s*\(tenant_id,\s*plan_id,\s*plan_version\)/i);
  assert.match(sql, /PRIMARY KEY\s*\(tenant_id,\s*actor_id,\s*operation,\s*key\)/i);
});

test("tenant child references are composite and ticket nonce replay is impossible", async () => {
  const sql = await migrationSql();
  assert.match(sql, /FOREIGN KEY\s*\(tenant_id,\s*plan_id,\s*plan_version\)[\s\S]*?REFERENCES storage\.plans\s*\(tenant_id,\s*id,\s*plan_version\)/i);
  assert.match(sql, /FOREIGN KEY\s*\(tenant_id,\s*execution_id\)[\s\S]*?REFERENCES storage\.executions\s*\(tenant_id,\s*id\)/i);
  assert.match(sql, /CREATE TABLE storage\.session_tickets[\s\S]*?nonce_hash text NOT NULL[\s\S]*?UNIQUE\s*\(tenant_id,\s*nonce_hash\)/i);
  assert.match(sql, /consumed_at timestamptz/i);
});

test("scheduler functions fence writes and expose only job scheduling metadata", async () => {
  const sql = await migrationSql();
  assert.match(sql, /CREATE FUNCTION storage\.claim_next_job/i);
  assert.match(sql, /CREATE FUNCTION storage\.heartbeat_job/i);
  assert.match(sql, /CREATE FUNCTION storage\.finish_job/i);
  assert.match(sql, /lease_owner\s*=\s*p_worker_id[\s\S]*?fence\s*=\s*p_fence/i);
  assert.match(sql, /SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, storage/i);
  assert.doesNotMatch(sql, /GRANT\s+SELECT\s+ON\s+ALL TABLES[^;]*changedesk_worker/i);
});
