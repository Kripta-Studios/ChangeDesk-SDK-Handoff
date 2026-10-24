import { Pool } from "pg";
import { resolve } from "node:path";
import { runMigrations } from "./migrations.js";

async function main() {
  const connectionString=process.env.CHANGEDESK_MIGRATOR_DATABASE_URL;
  if(!connectionString) throw new Error("CHANGEDESK_MIGRATOR_DATABASE_URL is required");
  const pool=new Pool({connectionString,application_name:"changedesk-migrator",max:1});
  try {
    await runMigrations(pool,resolve(__dirname,"../../migrations"));
  } finally {
    await pool.end();
  }
}

void main().catch((error:unknown)=>{
  const message=error instanceof Error?error.message:"Unknown migration failure";
  console.error(`Change Desk migration failed: ${message}`);
  process.exitCode=1;
});
