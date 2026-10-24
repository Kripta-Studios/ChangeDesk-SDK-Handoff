export { DurableWorker, ConnectorError } from "./runtime/worker.js";
export { StorageRuntimeAdapter } from "./runtime/storage-adapter.js";

import type { DurableWorker } from "./runtime/worker.js";
import { DurableWorker as WorkerImplementation } from "./runtime/worker.js";
import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { Store, JobStore } from "./storage/index.js";
import { StorageRuntimeAdapter } from "./runtime/storage-adapter.js";
import { ConfiguredHostRegistry } from "./adapter/registry.js";
import { SignedBridgeConnector } from "./adapter/bridge-connector.js";
import { StrictEffectAuthority } from "./runtime/authority.js";
import { createProductionCatalog, createProductionGenerationProcessor, publicationPrivateKeyFromPem } from "./planner/index.js";

export async function startWorker(worker: DurableWorker, options: { workerId: string; signal: AbortSignal; idleDelayMs?: number; concurrency?: number; recoveryIntervalMs?: number }): Promise<void> {
  const idleDelayMs = options.idleDelayMs ?? 500;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, 32));
  const lane = async (index: number) => { while (!options.signal.aborted) { const outcome = await worker.runOnce(`${options.workerId}-${index}`, options.signal); if (outcome === "idle") await abortableDelay(idleDelayMs + Math.floor(Math.random() * 200), options.signal); } };
  const recovery = async () => { while (!options.signal.aborted) { await abortableDelay(options.recoveryIntervalMs ?? 10_000, options.signal); if (!options.signal.aborted) await worker.recoverOrphanedLeases(100); } };
  await Promise.all([...Array(concurrency)].map((_, index) => lane(index)).concat([recovery()]));
}

export async function main(): Promise<void> {
  const config = loadConfig(); const pool = new Pool({ connectionString: config.workerDatabaseUrl, max: config.workerGlobalCap + 2 });
  const store = new Store(pool);
  const storage = new StorageRuntimeAdapter(store as any, new JobStore(pool) as any, { workerActorId: "unused-lease-actor-is-authoritative", leaseSeconds: config.workerLeaseSeconds, globalCap: config.workerGlobalCap });
  await storage.recoverOrphanedLeases(100);
  const catalog = createProductionCatalog(store, { publicationKeyId: config.publicationKeyId, publicationPrivateKey: publicationPrivateKeyFromPem(config.publicationPrivateKeyPem) });
  const generation = createProductionGenerationProcessor({ store, catalog, planner: { executable: config.planner.executable, executableSha256: config.planner.executableSha256, model: config.planner.model, allowedModels: config.planner.allowedModels,
    isolatedCwd: config.planner.isolatedCwd, outputSchemaPath: config.planner.outputSchemaPath, timeoutMs: config.planner.timeoutMs, maxOutputBytes: config.planner.maxOutputBytes,
    maxInputTokens: config.planner.maxInputTokens, environment: plannerEnvironment() }, workerLeaseSeconds: Math.min(config.workerLeaseSeconds, 300), maxAttempts: 3, totalTokenBudget: 409_152n, costBudgetMicros: 0n });
  const worker = new WorkerImplementation({ store: storage, connector: new SignedBridgeConnector(new ConfiguredHostRegistry(config.hosts)), authority: new StrictEffectAuthority(), generation });
  const controller = new AbortController(); const stop = () => controller.abort(); process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try { await startWorker(worker, { workerId: config.workerId, signal: controller.signal, concurrency: config.workerGlobalCap }); } finally { await pool.end(); }
}

function plannerEnvironment(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ["PATH", "Path", "CODEX_HOME", "USERPROFILE", "LOCALAPPDATA", "SYSTEMROOT"] as const) if (process.env[key]) result[key] = process.env[key]!;
  return result;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Worker startup failed"}\n`); process.exitCode = 1; });
