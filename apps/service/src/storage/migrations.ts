import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const MIGRATION_PATTERN=/^(\d+)_.*\.sql$/;
const LOCK_NAME="changedesk.storage.migrations.v1";

export async function runMigrations(pool:Pool,directory:URL|string):Promise<void> {
  const directoryPath=directory instanceof URL?fileURLToPath(directory):directory;
  const files=(await readdir(directoryPath)).filter((name)=>MIGRATION_PATTERN.test(name)).sort((a,b)=>Number(a.match(MIGRATION_PATTERN)?.[1])-Number(b.match(MIGRATION_PATTERN)?.[1]));
  const client=await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))",[LOCK_NAME]);
    await client.query(`CREATE TABLE IF NOT EXISTS public.changedesk_schema_migrations (
      version integer PRIMARY KEY,name text NOT NULL,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
    for(const file of files) {
      const version=Number(file.match(MIGRATION_PATTERN)?.[1]);
      const sql=await readFile(join(directoryPath,file),"utf8");
      const checksum=migrationChecksum(sql);
      const existing=await client.query<{checksum:string}>("SELECT checksum FROM public.changedesk_schema_migrations WHERE version=$1",[version]);
      if(existing.rowCount===1) {
        if(existing.rows[0]!.checksum!==checksum) throw new Error(`Migration checksum mismatch at version ${version}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO public.changedesk_schema_migrations(version,name,checksum) VALUES($1,$2,$3)",[version,file,checksum]);
        await client.query("COMMIT");
      } catch(error) { await client.query("ROLLBACK"); throw error; }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))",[LOCK_NAME]).catch(()=>undefined);
    client.release();
  }
}

/** Git may materialize SQL with CRLF on Windows; line endings are not semantic migration content. */
export function migrationChecksum(sql:string):string { return createHash("sha256").update(sql.replace(/\r\n/gu,"\n"),"utf8").digest("hex"); }
