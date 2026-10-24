export interface ServiceConfig {
  apiDatabaseUrl: string;
  workerDatabaseUrl: string;
  host: string;
  port: number;
  publicOriginAllowlist: readonly string[];
  sessionAudience: string;
  sessionIssuerAllowlist: readonly string[];
  sessionTtlSeconds: 300;
  bridgeTicketMaxTtlSeconds: 60;
  bodyLimitBytes: 65_536;
  workerId: string;
  workerLeaseSeconds: number;
  workerGlobalCap: number;
  hosts: readonly HostConfig[];
  publicationKeyId: string;
  publicationPrivateKeyPem: string;
  proofRequired: boolean;
  planner: { executable: string; executableSha256: string; model: string; allowedModels: readonly string[]; isolatedCwd: string; outputSchemaPath: string; timeoutMs: number; maxOutputBytes: number; maxInputTokens: number };
}
export interface HostConfig { tenantId: string; bootstrapIssuer: string; delegationIssuer: string; audience: string; commandUrl: string; reauthorizeUrl: string; bootstrapPublicKeyPem: string; delegationPrivateKeyPem: string; serviceToken: string; authorityCallbackCredential: string; categoryIds: readonly string[]; channelIds: readonly string[] }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const origins = splitRequired(env.CHANGEDESK_ORIGINS, "CHANGEDESK_ORIGINS");
  if (origins.some((origin) => origin === "*" || !/^https?:\/\//.test(origin))) throw new Error("CHANGEDESK_ORIGINS must contain exact HTTP(S) origins");
  return {
    apiDatabaseUrl: required(env.CHANGEDESK_API_DATABASE_URL, "CHANGEDESK_API_DATABASE_URL"),
    workerDatabaseUrl: required(env.CHANGEDESK_WORKER_DATABASE_URL, "CHANGEDESK_WORKER_DATABASE_URL"),
    host: env.CHANGEDESK_HOST ?? "127.0.0.1",
    port: parseInteger(env.CHANGEDESK_PORT ?? "4100", "CHANGEDESK_PORT", 1, 65_535),
    publicOriginAllowlist: origins,
    sessionAudience: required(env.CHANGEDESK_SESSION_AUDIENCE, "CHANGEDESK_SESSION_AUDIENCE"),
    sessionIssuerAllowlist: splitRequired(env.CHANGEDESK_SESSION_ISSUERS, "CHANGEDESK_SESSION_ISSUERS"),
    sessionTtlSeconds: 300,
    bridgeTicketMaxTtlSeconds: 60,
    bodyLimitBytes: 65_536,
    workerId: env.CHANGEDESK_WORKER_ID ?? `worker-${process.pid}`,
    workerLeaseSeconds: parseInteger(env.CHANGEDESK_WORKER_LEASE_SECONDS ?? "30", "CHANGEDESK_WORKER_LEASE_SECONDS", 5, 300),
    workerGlobalCap: parseInteger(env.CHANGEDESK_WORKER_GLOBAL_CAP ?? "8", "CHANGEDESK_WORKER_GLOBAL_CAP", 1, 100),
    hosts: parseHosts(required(env.CHANGEDESK_HOSTS_JSON, "CHANGEDESK_HOSTS_JSON")),
    publicationKeyId: required(env.CHANGEDESK_PUBLICATION_KEY_ID, "CHANGEDESK_PUBLICATION_KEY_ID"),
    publicationPrivateKeyPem: required(env.CHANGEDESK_PUBLICATION_PRIVATE_KEY_PEM, "CHANGEDESK_PUBLICATION_PRIVATE_KEY_PEM"),
    proofRequired: env.CHANGEDESK_PROOF_REQUIRED === "true",
    planner: { executable: required(env.CHANGEDESK_CODEX_EXECUTABLE, "CHANGEDESK_CODEX_EXECUTABLE"), executableSha256: hashRequired(env.CHANGEDESK_CODEX_EXECUTABLE_SHA256, "CHANGEDESK_CODEX_EXECUTABLE_SHA256"), model: required(env.CHANGEDESK_PLANNER_MODEL, "CHANGEDESK_PLANNER_MODEL"), allowedModels: splitRequired(env.CHANGEDESK_PLANNER_ALLOWED_MODELS, "CHANGEDESK_PLANNER_ALLOWED_MODELS"), isolatedCwd: required(env.CHANGEDESK_PLANNER_ISOLATED_CWD, "CHANGEDESK_PLANNER_ISOLATED_CWD"), outputSchemaPath: required(env.CHANGEDESK_PLANNER_OUTPUT_SCHEMA_PATH, "CHANGEDESK_PLANNER_OUTPUT_SCHEMA_PATH"), timeoutMs: parseInteger(env.CHANGEDESK_PLANNER_TIMEOUT_MS ?? "120000", "CHANGEDESK_PLANNER_TIMEOUT_MS", 1_000, 300_000), maxOutputBytes: parseInteger(env.CHANGEDESK_PLANNER_MAX_OUTPUT_BYTES ?? "65536", "CHANGEDESK_PLANNER_MAX_OUTPUT_BYTES", 1_024, 1_048_576), maxInputTokens: parseInteger(env.CHANGEDESK_PLANNER_MAX_INPUT_TOKENS ?? "120000", "CHANGEDESK_PLANNER_MAX_INPUT_TOKENS", 1_000, 1_000_000) },
  };
}
function parseHosts(value: string): HostConfig[] { const parsed: unknown = JSON.parse(value); if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error("CHANGEDESK_HOSTS_JSON must contain exactly two hosts"); return parsed.map((item: any) => { for (const key of ["tenantId","bootstrapIssuer","delegationIssuer","audience","commandUrl","reauthorizeUrl","bootstrapPublicKeyPem","delegationPrivateKeyPem","serviceToken","authorityCallbackCredential"]) if (typeof item?.[key] !== "string" || !item[key]) throw new Error(`Invalid host ${key}`); if (!Array.isArray(item.categoryIds) || !Array.isArray(item.channelIds)) throw new Error("Host resource allowlists are required"); return item as HostConfig; }); }
function required(value: string | undefined, name: string): string { if (!value) throw new Error(`${name} is required`); return value; }
function hashRequired(value: string | undefined, name: string): string { const result = required(value, name).toLowerCase(); if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${name} must be a lowercase SHA-256 hex digest`); return result; }
function splitRequired(value: string | undefined, name: string): string[] { return required(value, name).split(",").map((item) => item.trim()).filter(Boolean); }
function parseInteger(value: string, name: string, min: number, max: number): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} is invalid`); return parsed; }
