import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseRunIds } from "./benchmark-support.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serviceRequire = createRequire(path.join(root, "apps/service/package.json"));
const { Pool } = serviceRequire("pg");

async function main() {
  const connectionString = process.env.CHANGEDESK_MIGRATOR_DATABASE_URL;
  if (!connectionString) throw new Error("BLOCKED: CHANGEDESK_MIGRATOR_DATABASE_URL is required");
  const runIds = parseRunIds(process.argv.slice(2));
  const tenantIds = runIds.map((runId) => `bench-consumer-${runId}`);
  const pool = new Pool({ connectionString, application_name: "changedesk-benchmark-cancel", max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cancelled = await client.query(`UPDATE storage.jobs j
      SET status='cancelled',lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp()
      FROM storage.requests r
      WHERE j.tenant_id=ANY($1::text[]) AND j.tenant_id=r.tenant_id AND j.request_id=r.id
        AND j.kind='generation' AND j.status IN('pending','leased') AND r.redacted_text='benchmark synthetic request'
      RETURNING j.tenant_id`, [tenantIds]);
    const remaining = await client.query(`SELECT count(*)::integer AS count FROM storage.jobs j
      JOIN storage.requests r ON r.tenant_id=j.tenant_id AND r.id=j.request_id
      WHERE j.tenant_id=ANY($1::text[]) AND j.kind='generation' AND j.status IN('pending','leased')
        AND r.redacted_text='benchmark synthetic request'`, [tenantIds]);
    if (remaining.rows[0].count !== 0) throw new Error("Scoped benchmark jobs remain active; transaction rolled back");
    const statusRows = await client.query(`SELECT j.status,count(*)::integer AS count FROM storage.jobs j
      JOIN storage.requests r ON r.tenant_id=j.tenant_id AND r.id=j.request_id
      WHERE j.tenant_id=ANY($1::text[]) AND j.kind='generation' AND r.redacted_text='benchmark synthetic request'
      GROUP BY j.status ORDER BY j.status`, [tenantIds]);
    await client.query("COMMIT");
    process.stdout.write(`${JSON.stringify({ status: "PASS", runIds, cancelledJobs: cancelled.rowCount, jobsByStatus: Object.fromEntries(statusRows.rows.map((row) => [row.status, row.count])) })}\n`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
