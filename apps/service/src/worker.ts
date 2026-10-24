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
import { createProductionCatalog, createProductionGenerationProcessor, publicationPrivateKeyFromPem, type BootstrapPlannerConfig } from "./planner/index.js";
import type { PlannerConfig } from "./config.js";

export async function startWorker(worker: DurableWorker, options: { workerId: string; signal: AbortSignal; idleDelayMs?: number; concurrency?: number; recoveryIntervalMs?: number }): Promise<void> {
  const idleDelayMs = options.idleDelayMs ?? 500;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, 32));
  const lane = async (index: number) => { while (!options.signal.aborted) {
    try { const outcome = await worker.runOnce(`${options.workerId}-${index}`, options.signal); if (outcome === "idle") await abortableDelay(idleDelayMs + Math.floor(Math.random() * 200), options.signal); }
    catch { if (!options.signal.aborted) { process.stderr.write("Worker job failed; lease left for fenced recovery\n"); await abortableDelay(idleDelayMs, options.signal); } }
  } };
  const recovery = async () => { while (!options.signal.aborted) { await abortableDelay(options.recoveryIntervalMs ?? 10_000, options.signal); if (!options.signal.aborted) await worker.recoverOrphanedLeases(100); } };
  await Promise.all([...Array(concurrency)].map((_, index) => lane(index)).concat([recovery()]));
}

export async function main(): Promise<void> {
  const config = loadConfig(); const pool = new Pool({ connectionString: config.workerDatabaseUrl, max: config.workerGlobalCap + 2 });
  const store = new Store(pool);
  const storage = new StorageRuntimeAdapter(store as any, new JobStore(pool) as any, { workerActorId: "unused-lease-actor-is-authoritative", leaseSeconds: config.workerLeaseSeconds, globalCap: config.workerGlobalCap, proofRequired: config.proofRequired, ...(config.proofEnvironmentDigest ? { proofEnvironmentDigest: config.proofEnvironmentDigest } : {}) });
  await storage.recoverOrphanedLeases(100);
  const catalog = createProductionCatalog(store, { publicationKeyId: config.publicationKeyId, publicationPrivateKey: publicationPrivateKeyFromPem(config.publicationPrivateKeyPem) });
  const planner = plannerBootstrapConfig(config.planner);
  const generation = createProductionGenerationProcessor({ store, catalog, planner, workerLeaseSeconds: Math.min(config.workerLeaseSeconds, 300), maxAttempts: 3,
    totalTokenBudget: plannerTokenBudget(config.planner), costBudgetMicros: config.planner.kind === "api" ? usdToMicros(config.planner.config.authorizedBudgetUsd) : 0n });
  const worker = new WorkerImplementation({ store: storage, connector: new SignedBridgeConnector(new ConfiguredHostRegistry(config.hosts)), authority: new StrictEffectAuthority(), generation });
  const controller = new AbortController(); const stop = () => controller.abort(); process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try { await startWorker(worker, { workerId: config.workerId, signal: controller.signal, concurrency: config.workerGlobalCap }); } finally { await pool.end(); }
}

export function plannerBootstrapConfig(config: PlannerConfig): BootstrapPlannerConfig {
  if (config.kind === "api") return { kind: "api", config: config.config, secrets: { get: async (name) => name === config.config.apiKeyEnvironmentName ? process.env[name] ?? null : null } };
  if (config.kind === "fake-test") return config;
  return { ...config, kind: "codex-cli", environment: plannerEnvironment() };
}

function plannerTokenBudget(config: PlannerConfig): bigint {
  if (config.kind === "api") return BigInt(3 * (config.config.maxInputTokens + config.config.maxOutputTokens));
  return config.kind === "fake-test" ? 409_152n : BigInt(3 * (config.maxInputTokens + 16_384));
}

function usdToMicros(value: number): bigint { return BigInt(Math.floor(value * 1_000_000)); }

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
