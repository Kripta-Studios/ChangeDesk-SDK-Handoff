import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { hashCanonical } from "./core/hashing.js";

type Role = "viewer" | "requester" | "operator" | "admin";
export interface ProvisionConfig {
  tenants: readonly {
    tenantId: string; backendKey: string; policyVersion: string;
    actors: readonly { actorId: string; role: Role }[];
    capabilityManifest: { id: string; adapterVersion: "medusa-2.22.1/changedesk-1"; body: { adapter: "medusa-v2"; capabilities: readonly string[]; capabilityContract: "1"; verifiedMedusaVersion: "2.22.1" } };
  }[];
  publicationKey: { id: string; ownerTenantId: string; publicKeyPem: string };
}
interface PoolLike { connect(): Promise<Pick<PoolClient, "query" | "release">> }

export async function provisionDatabase(pool: PoolLike, config: ProvisionConfig): Promise<void> {
  validate(config);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["changedesk.service.provision.v1"]);
    for (const tenant of config.tenants) {
      const bootstrapActor = tenant.actors.find((actor) => actor.role === "admin") ?? tenant.actors[0]!;
      await scope(client, tenant.tenantId, bootstrapActor.actorId);
      await client.query(`INSERT INTO storage.tenants(id,app_kind,backend_key,status,policy_version)
        VALUES($1,'medusa',$2,'active',$3) ON CONFLICT(id) DO NOTHING`, [tenant.tenantId, tenant.backendKey, tenant.policyVersion]);
      const tenantRow = await client.query<{ id:string;app_kind:string;backend_key:string;status:string;policy_version:string }>(
        "SELECT id,app_kind,backend_key,status,policy_version FROM storage.tenants WHERE id=$1", [tenant.tenantId]);
      const persistedTenant = tenantRow.rows[0];
      if (!persistedTenant || persistedTenant.app_kind !== "medusa" || persistedTenant.backend_key !== tenant.backendKey) throw new Error(`Provisioning drift for tenant ${tenant.tenantId}`);
      await client.query("UPDATE storage.tenants SET status='active',policy_version=$2 WHERE id=$1", [tenant.tenantId, tenant.policyVersion]);

      for (const actor of tenant.actors) {
        await scope(client, tenant.tenantId, actor.actorId);
        await client.query(`INSERT INTO storage.actors(tenant_id,actor_id,host_subject,role,state,last_policy_version)
          VALUES($1,$2,$2,$3,'enabled',$4) ON CONFLICT(tenant_id,actor_id) DO NOTHING`, [tenant.tenantId, actor.actorId, actor.role, tenant.policyVersion]);
        const actorRow = await client.query<{ actor_id:string;host_subject:string;role:string;state:string;last_policy_version:string }>(
          "SELECT actor_id,host_subject,role,state,last_policy_version FROM storage.actors WHERE tenant_id=$1 AND actor_id=$2", [tenant.tenantId, actor.actorId]);
        if (!actorRow.rows[0] || actorRow.rows[0].host_subject !== actor.actorId) throw new Error(`Provisioning drift for actor ${tenant.tenantId}/${actor.actorId}`);
        await client.query("UPDATE storage.actors SET role=$3,state='enabled',last_policy_version=$4 WHERE tenant_id=$1 AND actor_id=$2", [tenant.tenantId, actor.actorId, actor.role, tenant.policyVersion]);
      }

      await scope(client, tenant.tenantId, bootstrapActor.actorId);
      const manifestHash = hashCanonical("capability-manifest", "1", tenant.capabilityManifest.body);
      const existingManifest = await client.query<{ id:string;manifest_hash:string;adapter_version:string;body:unknown }>(
        "SELECT id,manifest_hash,adapter_version,body FROM storage.capability_manifests WHERE tenant_id=$1 AND (id=$2 OR manifest_hash=$3)", [tenant.tenantId, tenant.capabilityManifest.id, manifestHash]);
      const existing = existingManifest.rows[0];
      if (existing && (existing.id !== tenant.capabilityManifest.id || existing.manifest_hash !== manifestHash || existing.adapter_version !== tenant.capabilityManifest.adapterVersion || hashCanonical("capability-manifest", "1", existing.body as object) !== manifestHash)) throw new Error(`Provisioning drift for capability manifest ${tenant.tenantId}/${tenant.capabilityManifest.id}`);
      await client.query("UPDATE storage.capability_manifests SET active=false WHERE tenant_id=$1 AND active", [tenant.tenantId]);
      await client.query(`INSERT INTO storage.capability_manifests(tenant_id,id,manifest_hash,adapter_version,body,active)
        VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(tenant_id,manifest_hash) DO UPDATE SET active=true`,
        [tenant.tenantId, tenant.capabilityManifest.id, manifestHash, tenant.capabilityManifest.adapterVersion, tenant.capabilityManifest.body]);
    }

    const owner = config.tenants.find((tenant) => tenant.tenantId === config.publicationKey.ownerTenantId)!;
    const ownerActor = owner.actors.find((actor) => actor.role === "admin") ?? owner.actors[0]!;
    await scope(client, owner.tenantId, ownerActor.actorId);
    const publicKey = createPublicKey(config.publicationKey.publicKeyPem).export({ format: "der", type: "spki" });
    const existingKey = await client.query<{ id:string;owner_tenant_id:string|null;algorithm:string;public_key:Buffer;status:string }>(
      "SELECT id,owner_tenant_id,algorithm,public_key,status FROM storage.signing_keys WHERE id=$1", [config.publicationKey.id]);
    const key = existingKey.rows[0];
    if (key && (key.owner_tenant_id !== owner.tenantId || key.algorithm !== "Ed25519" || key.status !== "active" || !Buffer.from(key.public_key).equals(publicKey))) throw new Error(`Provisioning drift for publication key ${config.publicationKey.id}`);
    if (!key) await client.query("INSERT INTO storage.signing_keys(id,owner_tenant_id,algorithm,public_key,status) VALUES($1,$2,'Ed25519',$3,'active')", [config.publicationKey.id, owner.tenantId, publicKey]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

function validate(config: ProvisionConfig): void {
  if (!config || !Array.isArray(config.tenants) || config.tenants.length !== 2) throw new Error("Provisioning requires exactly two tenants");
  exactKeys(config as unknown as Record<string,unknown>, ["tenants","publicationKey"], "provision config");
  const tenants = new Set<string>(), actors = new Set<string>();
  for (const tenant of config.tenants) {
    exactKeys(tenant as unknown as Record<string,unknown>, ["tenantId","backendKey","policyVersion","actors","capabilityManifest"], "tenant");
    if (!tenant.tenantId || !tenant.backendKey || !tenant.policyVersion || tenants.has(tenant.tenantId)) throw new Error("Invalid or duplicate tenant");
    tenants.add(tenant.tenantId);
    if (!Array.isArray(tenant.actors) || tenant.actors.length === 0) throw new Error(`Actors are required for ${tenant.tenantId}`);
    for (const actor of tenant.actors) {
      exactKeys(actor as unknown as Record<string,unknown>, ["actorId","role"], "actor");
      const identity = `${tenant.tenantId}\0${actor.actorId}`;
      if (!actor.actorId || actors.has(identity)) throw new Error("Invalid or duplicate actor identity");
      if (!["viewer", "requester", "operator", "admin"].includes(actor.role)) throw new Error("Invalid actor role");
      actors.add(identity);
    }
    exactKeys(tenant.capabilityManifest as unknown as Record<string,unknown>, ["id","adapterVersion","body"], "capability manifest");
    exactKeys(tenant.capabilityManifest.body as unknown as Record<string,unknown>, ["adapter","capabilities","capabilityContract","verifiedMedusaVersion"], "capability manifest body");
    if (tenant.capabilityManifest.adapterVersion !== "medusa-2.22.1/changedesk-1" || tenant.capabilityManifest.body.adapter !== "medusa-v2" || tenant.capabilityManifest.body.capabilityContract !== "1" || tenant.capabilityManifest.body.verifiedMedusaVersion !== "2.22.1") throw new Error("Invalid capability manifest profile");
    const expectedCapabilities=["medusa.product_categories.products.add","medusa.product_categories.retrieve","medusa.products.list","medusa.products.retrieve","medusa.sales_channels.products.add","medusa.sales_channels.retrieve"];
    if ([...new Set(tenant.capabilityManifest.body.capabilities)].sort().join("\0") !== expectedCapabilities.join("\0")) throw new Error("Invalid capability manifest capabilities");
  }
  exactKeys(config.publicationKey as unknown as Record<string,unknown>, ["id","ownerTenantId","publicKeyPem"], "publication key");
  if (!config.publicationKey?.id || !tenants.has(config.publicationKey.ownerTenantId) || !config.publicationKey.publicKeyPem) throw new Error("Invalid publication key owner");
}
function exactKeys(value:Record<string,unknown>,allowed:readonly string[],name:string){if(Object.keys(value).some((key)=>!allowed.includes(key)))throw new Error(`Unexpected field in ${name}`);}
async function scope(client: Pick<PoolClient,"query">, tenantId:string, actorId:string) { await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)", [tenantId, actorId]); }

export async function main(): Promise<void> {
  const databaseUrl = process.env.CHANGEDESK_MIGRATOR_DATABASE_URL;
  const file = process.env.CHANGEDESK_PROVISION_FILE;
  if (!databaseUrl || !file) throw new Error("CHANGEDESK_MIGRATOR_DATABASE_URL and CHANGEDESK_PROVISION_FILE are required");
  const config = JSON.parse(await readFile(file, "utf8")) as ProvisionConfig;
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try { await provisionDatabase(pool, config); } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Provisioning failed"}\n`); process.exitCode = 1; });
