export type { ApiOperations } from "./api/ports.js";

import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { loadConfig, type ServiceConfig } from "./config.js";
import { Store, TicketReplayStore } from "./storage/index.js";
import { ConfiguredHostRegistry } from "./adapter/registry.js";
import { SignedBridgeConnector } from "./adapter/bridge-connector.js";
import { StorageApiOperations } from "./api/storage-operations.js";
import { buildApi } from "./api/server.js";
import { SessionManager } from "./api/session.js";
import { BuyerSessionManager } from "./storefront/session.js";
import { ConfiguredBuyerHostRegistry } from "./storefront/host-registry.js";
import { PostgresStorefrontRepository } from "./storefront/postgres-repository.js";
import { PostgresBuyerTicketReplayStore } from "./storefront/buyer-ticket-store.js";
export { buildApi, SessionManager };

export async function startApi(app: FastifyInstance, config: ServiceConfig): Promise<void> {
  await app.listen({ host: config.host, port: config.port });
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  const store = new Store(pool);
  const registry = new ConfiguredHostRegistry(config.hosts);
  const sessions = new SessionManager(new TicketReplayStore(store), registry, { audience: config.sessionAudience, issuers: config.sessionIssuerAllowlist, origins: config.publicOriginAllowlist, ticketMaxTtlSeconds: config.bridgeTicketMaxTtlSeconds, sessionTtlSeconds: config.sessionTtlSeconds });
  const buyerSessions = new BuyerSessionManager(new PostgresBuyerTicketReplayStore(pool), new ConfiguredBuyerHostRegistry(config.hosts), { audience: `${config.sessionAudience}:storefront`, issuers: config.sessionIssuerAllowlist, origins: config.publicOriginAllowlist, ticketMaxTtlSeconds: config.bridgeTicketMaxTtlSeconds, sessionTtlSeconds: config.sessionTtlSeconds });
  const connector = new SignedBridgeConnector(registry);
  const resourceIds = Object.fromEntries(config.hosts.map((host) => [host.tenantId, { category: host.categoryIds, channel: host.channelIds }]));
  const app = buildApi({ config, sessions, operations: new StorageApiOperations(store, connector, resourceIds), storefront: { repository: new PostgresStorefrontRepository(pool), buyerSessions } });
  const shutdown = async () => { await app.close(); await pool.end(); };
  process.once("SIGINT", () => void shutdown()); process.once("SIGTERM", () => void shutdown());
  await startApi(app, config);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "API startup failed"}\n`); process.exitCode = 1; });
