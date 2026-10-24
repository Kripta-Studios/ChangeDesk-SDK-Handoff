import { describe, expect, it, vi } from "vitest";
import { provisionDatabase, type ProvisionConfig } from "../../src/provision.js";

const manifest = { capabilities: ["medusa.products.list", "medusa.products.retrieve", "medusa.product_categories.retrieve", "medusa.sales_channels.retrieve", "medusa.product_categories.products.add", "medusa.sales_channels.products.add"], capabilityContract: "1", verifiedMedusaVersion: "2.22.1" };
const config: ProvisionConfig = { tenants: [{ tenantId: "atlas", backendKey: "atlas", policyVersion: "1", actors: [{ actorId: "actor-admin", role: "admin" }], capabilityManifest: { id: "atlas-medusa-v2", adapterVersion: "medusa-v2", body: manifest } }], publicationKey: { id: "publication-v1", ownerTenantId: "atlas", publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWz6BZ1ZRBMnUMJBQ9mYcTq1fYE=\n-----END PUBLIC KEY-----" } };

describe("service provisioner", () => {
  it("converges trusted tenant, actor, manifest and publication key records in one transaction", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id,app_kind")) return { rowCount: 1, rows: [{ id: "atlas", app_kind: "medusa", backend_key: "atlas", status: "active", policy_version: "1" }] };
      if (sql.includes("SELECT actor_id,host_subject")) return { rowCount: 1, rows: [{ actor_id: "actor-admin", host_subject: "actor-admin", role: "admin", state: "enabled", last_policy_version: "1" }] };
      if (sql.includes("SELECT id,manifest_hash")) return { rowCount: 0, rows: [] };
      if (sql.includes("SELECT id,owner_tenant_id")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    });
    const release = vi.fn();
    await provisionDatabase({ connect: vi.fn().mockResolvedValue({ query, release }) } as any, config);
    expect(query.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(query).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects duplicate actor identities before touching PostgreSQL", async () => {
    const duplicate = { ...config, tenants: [{ ...config.tenants[0]!, actors: [{ actorId: "same", role: "admin" as const }, { actorId: "same", role: "viewer" as const }] }] };
    const connect = vi.fn();
    await expect(provisionDatabase({ connect } as any, duplicate)).rejects.toThrow(/duplicate actor/i);
    expect(connect).not.toHaveBeenCalled();
  });
});
