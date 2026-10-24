import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { benchmarkStatus, persistenceMetrics, requireBenchmarkEnvironment, summarize } from "./benchmark-support.mjs";

const CATALOG_ENTRIES = 1_000;
const CATALOG_WARMUP = 20;
const CATALOG_SAMPLES = 200;
const ADMISSION_WARMUP = 10;
const ADMISSION_SAMPLES = 80;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serviceRequire = createRequire(path.join(REPOSITORY_ROOT, "apps/service/package.json"));
const { Pool } = serviceRequire("pg");

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function seedIdentity(pool, tenantId, actorId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)", [tenantId, actorId]);
    await client.query("INSERT INTO storage.tenants (id,app_kind,backend_key,status,policy_version) VALUES($1,'medusa',$1,'active','1') ON CONFLICT DO NOTHING", [tenantId]);
    await client.query("INSERT INTO storage.actors (tenant_id,actor_id,host_subject,role,state,last_policy_version) VALUES($1,$2,$2,'operator','enabled','1') ON CONFLICT DO NOTHING", [tenantId, actorId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function measureCatalog(store, tenantId, actorId) {
  const query = { adapter: "medusa-v2", capabilityContract: "1", limit: 20 };
  const samples = [];
  let errors = 0;
  for (let index = 0; index < CATALOG_WARMUP + CATALOG_SAMPLES; index += 1) {
    const started = performance.now();
    try {
      const rows = await store.withTenant({ tenantId, actorId }, (tx) => tx.listDiscoverableCatalog(query));
      if (rows.length !== 20 || rows.some((row) => row.ownerTenantId === tenantId)) throw new Error("ACL catalog query did not return twenty granted cross-tenant artifacts");
    } catch (error) {
      errors += 1;
      if (index >= CATALOG_WARMUP) samples.push(performance.now() - started);
      if (errors === 1) process.stderr.write(`catalog sample failed: ${error instanceof Error ? error.message : String(error)}\n`);
      continue;
    }
    if (index >= CATALOG_WARMUP) samples.push(performance.now() - started);
  }
  return summarize(samples, errors);
}

async function measureAdmission(app, store, actor, origin) {
  const samples = [];
  let errors = 0;
  let lastRequestId;
  for (let index = 0; index < ADMISSION_WARMUP + ADMISSION_SAMPLES; index += 1) {
    const started = performance.now();
    const idempotencyKey = randomUUID();
    const response = await app.inject({
      method: "POST",
      url: "/v1/requests",
      headers: { authorization: `Bearer ${"x".repeat(43)}`, origin, "idempotency-key": idempotencyKey },
      payload: { message: "benchmark synthetic request", selectedProductIds: ["prod_synthetic"], clientRequestId: randomUUID() }
    });
    const elapsed = performance.now() - started;
    let body;
    try { body = response.json(); } catch { body = undefined; }
    if (response.statusCode !== 200 || typeof body?.requestId !== "string" || body.status !== "received") {
      errors += 1;
      if (errors === 1) process.stderr.write(`admission sample failed: HTTP ${response.statusCode}\n`);
    } else {
      lastRequestId = body.requestId;
    }
    if (index >= ADMISSION_WARMUP) samples.push(elapsed);
  }
  if (!lastRequestId || !await store.withTenant(actor, (tx) => tx.getRequest(lastRequestId))) {
    throw new Error("FAIL: the final API response did not identify a durable request");
  }
  return summarize(samples, errors);
}

async function logicalPersistedBytes(pool, ownerTenantId, consumerTenantId) {
  const result = await pool.query(`SELECT
    (SELECT COALESCE(sum(pg_column_size(a)),0) FROM storage.recipe_artifacts a WHERE a.owner_tenant_id=$1)
      + (SELECT COALESCE(sum(pg_column_size(g)),0) FROM storage.artifact_grants g JOIN storage.recipe_artifacts a ON a.id=g.artifact_id WHERE a.owner_tenant_id=$1)
      + (SELECT COALESCE(sum(pg_column_size(i)),0) FROM storage.idempotency_records i WHERE i.tenant_id=$1) AS catalog_bytes,
    (SELECT COALESCE(sum(pg_column_size(r)),0) FROM storage.requests r WHERE r.tenant_id=$2)
      + (SELECT COALESCE(sum(pg_column_size(j)),0) FROM storage.jobs j WHERE j.tenant_id=$2)
      + (SELECT COALESCE(sum(pg_column_size(i)),0) FROM storage.idempotency_records i WHERE i.tenant_id=$2) AS admission_bytes`, [ownerTenantId, consumerTenantId]);
  return { catalog: Number(result.rows[0].catalog_bytes), admission: Number(result.rows[0].admission_bytes) };
}

async function main() {
  const root = REPOSITORY_ROOT;
  const { migratorDatabaseUrl, runtimeDatabaseUrl } = requireBenchmarkEnvironment();
  const [{ runMigrations, Store }, { buildApi }, { StorageApiOperations }] = await Promise.all([
    import(pathToFileURL(path.join(root, "apps/service/dist/storage/index.js"))),
    import(pathToFileURL(path.join(root, "apps/service/dist/api/server.js"))),
    import(pathToFileURL(path.join(root, "apps/service/dist/api/storage-operations.js")))
  ]).catch((error) => { throw new Error(`BLOCKED: build @changedesk/contracts and @changedesk/service before benchmarking (${error.message})`); });

  const migrator = new Pool({ connectionString: migratorDatabaseUrl, application_name: "changedesk-benchmark-migrator", max: 1 });
  const runtime = new Pool({ connectionString: runtimeDatabaseUrl, application_name: "changedesk-benchmark-runtime", max: 8 });
  const store = new Store(runtime);
  const runId = randomUUID();
  const ownerTenantId = `bench-owner-${runId}`;
  const consumerTenantId = `bench-consumer-${runId}`;
  const actorId = "benchmark-operator";
  const origin = "http://localhost:9001";
  let app;
  try {
    await runMigrations(migrator, path.join(root, "apps/service/migrations"));
    await seedIdentity(migrator, ownerTenantId, actorId);
    await seedIdentity(migrator, consumerTenantId, actorId);
    const databaseBytesBefore = Number((await migrator.query("SELECT pg_database_size(current_database()) AS bytes")).rows[0].bytes);
    const setupStarted = performance.now();
    await store.withTenant({ tenantId: ownerTenantId, actorId }, async (tx) => {
      for (let index = 0; index < CATALOG_ENTRIES; index += 1) {
        const artifactHash = hash(`${runId}:artifact:${index}`);
        const artifact = await tx.insertArtifact({
          id: randomUUID(), artifactHash, schemaVersion: "1.0",
          canonicalBody: { recipeKey: `benchmark.recipe.${index}.v1`, compatibility: { adapter: "medusa-v2", capabilityContract: "1" } },
          idempotencyKey: randomUUID(), requestHash: hash(`${runId}:artifact-request:${index}`)
        });
        await tx.grantArtifact({
          id: randomUUID(), artifactId: artifact.id, recipientScope: "tenant", recipientTenantId: consumerTenantId,
          rights: ["read", "install"], idempotencyKey: randomUUID(), requestHash: hash(`${runId}:grant-request:${index}`)
        });
      }
    });
    const setupMilliseconds = performance.now() - setupStarted;
    const catalog = await measureCatalog(store, consumerTenantId, actorId);

    const actor = { tenantId: consumerTenantId, actorId, hostSessionId: "benchmark-session", roles: ["operator"], policyVersion: "1", expiresAt: "2099-01-01T00:00:00.000Z" };
    const sessions = { authenticate: async () => actor, exchange: async () => { throw new Error("not used"); } };
    const connector = { readAuthorized: async () => { throw new Error("not used"); }, executeAuthorized: async () => { throw new Error("not used"); }, reconcileOperation: async () => { throw new Error("not used"); } };
    const operations = new StorageApiOperations(store, connector, {});
    const config = {
      apiDatabaseUrl: "redacted", workerDatabaseUrl: "redacted", host: "127.0.0.1", port: 4100,
      publicOriginAllowlist: [origin], sessionAudience: "changedesk", sessionIssuerAllowlist: ["benchmark"],
      sessionTtlSeconds: 300, bridgeTicketMaxTtlSeconds: 60, bodyLimitBytes: 65_536,
      workerId: "benchmark", workerLeaseSeconds: 30, workerGlobalCap: 8, hosts: []
    };
    app = buildApi({ config, sessions, operations });
    await app.ready();
    const admission = await measureAdmission(app, store, { tenantId: consumerTenantId, actorId }, origin);
    const databaseBytesAfter = Number((await migrator.query("SELECT pg_database_size(current_database()) AS bytes")).rows[0].bytes);
    const logicalBytes = await logicalPersistedBytes(migrator, ownerTenantId, consumerTenantId);
    const serverVersion = (await migrator.query("SHOW server_version")).rows[0]?.server_version;
    const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", shell: false }).stdout.trim();
    const dirty = spawnSync("git", ["diff", "--quiet", "HEAD"], { cwd: root, shell: false }).status !== 0;
    const evidence = {
      schemaVersion: "1.0.0", status: benchmarkStatus(catalog, admission),
      measuredAt: new Date().toISOString(), revision, dirty,
      environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? "unknown", logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), postgresql: serverVersion },
      dataset: { runId, synthetic: true, authorizedCatalogEntries: CATALOG_ENTRIES, catalogPageLimit: 20, setupMilliseconds, persisted: persistenceMetrics(databaseBytesBefore, databaseBytesAfter, logicalBytes.catalog, logicalBytes.admission) },
      catalog: { ...catalog, warmupSamples: CATALOG_WARMUP, targetP95Milliseconds: 250, targetMet: catalog.errors === 0 && catalog.p95 <= 250, authorization: "explicit cross-tenant read/install grants" },
      admission: { ...admission, warmupSamples: ADMISSION_WARMUP, targetP95Milliseconds: 300, targetMet: admission.errors === 0 && admission.p95 <= 300, boundary: "Fastify inject through validation, canonical request hash and committed PostgreSQL request+job", authentication: "preauthenticated benchmark adapter; session cryptography excluded" },
      limitations: ["In-process Fastify injection excludes network latency", "Catalog measures a page of 20 over 1,000 authorized entries", "Synthetic laboratory data only; this is not an unlimited-scale claim"]
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    const outputIndex = process.argv.indexOf("--output");
    if (outputIndex >= 0) {
      const output = path.resolve(root, process.argv[outputIndex + 1] ?? "");
      const evidenceRoot = path.join(root, "evidence") + path.sep;
      if (!output.startsWith(evidenceRoot)) throw new Error("Output must be inside evidence/");
      await writeFile(output, serialized, { encoding: "utf8", flag: "wx" });
    }
    process.stdout.write(serialized);
    if (evidence.status !== "PASS" || !evidence.catalog.targetMet || !evidence.admission.targetMet) process.exitCode = 1;
  } finally {
    if (app) await app.close();
    await runtime.end();
    await migrator.end();
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2; });
}
