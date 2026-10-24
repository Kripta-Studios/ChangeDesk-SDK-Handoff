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
import { createPrivateKey, randomUUID } from "node:crypto";
import { artifactHash, canonicalizeJson, hashCanonical } from "./core/hashing.js";
import { createContractValidator } from "./core/validation.js";
import { permissionsForRole } from "./policy/index.js";
import { AuthorizedCatalog, CodexCliPlannerProvider, FixedArgvProcessRunner, InstalledCodex0164IsolationProbe, NodeEd25519Signer, PlannerGenerationProcessor, PostgresCatalogRepository, PostgresGenerationUsageLedger, ValidatingPlanner } from "./planner/index.js";

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
  const identity = { hash: async (recipe: any) => artifactHash(recipe), requestHash: async (value: any) => hashCanonical("catalog-request", "1", value) };
  const catalog = new AuthorizedCatalog({ repository: new PostgresCatalogRepository(store as any, () => randomUUID()), identity,
    encoder: { encode: (value) => Buffer.from(canonicalizeJson(value), "utf8") }, signer: new NodeEd25519Signer(new Map([[config.publicationKeyId, createPrivateKey(config.publicationPrivateKeyPem)]])),
    permissionsFor: (actor) => permissionsForRole(actor.role), newId: () => randomUUID() });
  const provider = new CodexCliPlannerProvider({ executable: config.planner.executable, executableSha256: config.planner.executableSha256, model: config.planner.model, allowedModels: config.planner.allowedModels,
    isolatedCwd: config.planner.isolatedCwd, outputSchemaPath: config.planner.outputSchemaPath, timeoutMs: config.planner.timeoutMs, maxOutputBytes: config.planner.maxOutputBytes,
    maxReportedInputTokens: config.planner.maxInputTokens, environment: plannerEnvironment() }, new FixedArgvProcessRunner(), new InstalledCodex0164IsolationProbe("0.164.0", config.planner.executableSha256));
  const validator = createContractValidator({ verifiedMedusaVersion: "2.22.1" });
  const planner = new ValidatingPlanner(provider, (value, approvedCapabilities, adapter) => { const result = validator.validateRecipe(value); if (!result.ok) return { ok: false, code: result.issues[0]?.code ?? "recipe_invalid" }; if (result.value.compatibility.adapter !== adapter.id || result.value.compatibility.capabilityContract !== adapter.capabilityContract || result.value.requiredCapabilities.some((capability) => !approvedCapabilities.includes(capability))) return { ok: false, code: "recipe_authority_invalid" }; return { ok: true, recipe: result.value }; }, { maxCalls: 1 as const, maxMessageCharacters: 4_000 });
  const generation = new PlannerGenerationProcessor({ store: store as any, planner, catalog, identity, adapter: { id: "medusa-v2", capabilityContract: "1", version: "2.22.1" }, usageLedger: new PostgresGenerationUsageLedger(store as any),
    budget: { provider: "codex-cli", model: config.planner.model, maxAttempts: 3, tokenBudget: 409_152n, costBudgetMicros: 1n, leaseSeconds: Math.min(config.workerLeaseSeconds, 300), intentHash: async (input) => hashCanonical("planner-intent", "1", input as any) }, newId: () => randomUUID() });
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
