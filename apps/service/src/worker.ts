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

export async function startWorker(worker: DurableWorker, options: { workerId: string; signal: AbortSignal; idleDelayMs?: number }): Promise<void> {
  const idleDelayMs = options.idleDelayMs ?? 500;
  while (!options.signal.aborted) {
    const outcome = await worker.runOnce(options.workerId);
    if (outcome === "idle") await abortableDelay(idleDelayMs, options.signal);
  }
}

export async function main(): Promise<void> {
  const config = loadConfig(); const pool = new Pool({ connectionString: config.databaseUrl, max: config.workerGlobalCap + 2 });
  const storage = new StorageRuntimeAdapter(new Store(pool) as any, new JobStore(pool) as any, { workerActorId: "unused-lease-actor-is-authoritative", leaseSeconds: config.workerLeaseSeconds, globalCap: config.workerGlobalCap });
  await storage.recoverOrphanedLeases(100);
  const worker = new WorkerImplementation({ store: storage, connector: new SignedBridgeConnector(new ConfiguredHostRegistry(config.hosts)), authority: new StrictEffectAuthority() });
  const controller = new AbortController(); const stop = () => controller.abort(); process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try { await startWorker(worker, { workerId: config.workerId, signal: controller.signal }); } finally { await pool.end(); }
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Worker startup failed"}\n`); process.exitCode = 1; });
