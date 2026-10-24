import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, expect, test } from "vitest";
import type { ActorContext } from "@changedesk/contracts";
import { artifactHash, canonicalizeJson, hashCanonical } from "../../apps/service/src/core/hashing.ts";
import { permissionsForRole } from "../../apps/service/src/policy/index.ts";
import { AuthorizedCatalog } from "../../apps/service/src/planner/catalog.ts";
import { PostgresCatalogRepository } from "../../apps/service/src/planner/postgres-catalog.ts";
import { canonicalGenericRecipe } from "../../apps/service/src/planner/publication.ts";
import { runMigrations, Store } from "../../apps/service/src/storage/index.ts";

const migratorUrl=process.env.CHANGEDESK_MIGRATOR_DATABASE_URL,runtimeUrl=process.env.CHANGEDESK_RUNTIME_DATABASE_URL;
if(!migratorUrl||!runtimeUrl)throw new Error("BLOCKED: CHANGEDESK_MIGRATOR_DATABASE_URL and CHANGEDESK_RUNTIME_DATABASE_URL are required for the real PostgreSQL catalog discovery test");
const migrator=new Pool({connectionString:migratorUrl}),runtime=new Pool({connectionString:runtimeUrl,max:3}),store=new Store(runtime);
beforeAll(()=>runMigrations(migrator,new URL("../../apps/service/migrations/",import.meta.url)));afterAll(async()=>{await runtime.end();await migrator.end();});

test("real PostgreSQL grants expose a signed offer only to Boreal and withdrawal removes it",async()=>{
  const suffix=randomUUID().slice(0,8),atlas=actor(`atlas-${suffix}`),boreal=actor(`boreal-${suffix}`),denied=actor(`denied-${suffix}`);
  for(const current of [atlas,boreal,denied])await seed(current);
  const recipe=canonicalGenericRecipe("catalog.category.assign.v1"),hash=artifactHash(recipe),keyId=`key-${suffix}`,{privateKey,publicKey}=generateKeyPairSync("ed25519");
  await store.withTenant(atlas,async(tx)=>{await tx.insertArtifact({id:randomUUID(),artifactHash:hash,schemaVersion:recipe.schemaVersion,canonicalBody:recipe,idempotencyKey:randomUUID(),requestHash:hashCanonical("test-artifact","1",{hash})});await tx.insertSigningKey({id:keyId,publicKey:publicKey.export({format:"der",type:"spki"}),privateKeyRef:"external:test-only",idempotencyKey:randomUUID(),requestHash:hashCanonical("test-key","1",{keyId})});});
  const catalog=new AuthorizedCatalog({repository:new PostgresCatalogRepository(store,()=>randomUUID()),identity:{hash:async(value)=>artifactHash(value),requestHash:async(value)=>hashCanonical("catalog-request","1",value as object)},encoder:{encode:(value)=>Buffer.from(canonicalizeJson(value),"utf8")},signer:{async sign(_id,bytes){return sign(null,bytes,privateKey);}},permissionsFor:(current)=>permissionsForRole(current.role),newId:()=>randomUUID()});
  const publication=await catalog.publishAuthorized({actor:atlas,sourceArtifactHash:hash,visibility:"shared_allowlist",allowedTenantIds:[boreal.tenantId],consent:true,keyId,idempotencyKey:randomUUID()});
  const query=(current:ActorContext)=>({actor:current,adapter:{id:"medusa-v2" as const,capabilityContract:"1" as const,version:"2.22.1"},approvedCapabilities:recipe.requiredCapabilities,limit:20});
  const offers=await catalog.discoverInstallOffers(query(boreal));expect(offers).toEqual([{artifactHash:hash,displayName:"Assign category",version:"1",recipeKey:"catalog.category.assign.v1",requiredParameters:["categoryId"],evidenceStatus:"not_run"}]);
  expect(await catalog.discoverInstallOffers(query(denied))).toEqual([]);
  await catalog.withdrawAuthorized({actor:atlas,publicationId:publication.publicationId,idempotencyKey:randomUUID()});expect(await catalog.discoverInstallOffers(query(boreal))).toEqual([]);
},30_000);

function actor(tenantId:string):ActorContext{return{tenantId,actorId:"admin",role:"admin",enabled:true};}
async function seed(current:ActorContext){const client=await migrator.connect();try{await client.query("BEGIN");await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)",[current.tenantId,current.actorId]);await client.query("INSERT INTO storage.tenants(id,app_kind,backend_key,status,policy_version) VALUES($1,'medusa',$1,'active','1')",[current.tenantId]);await client.query("INSERT INTO storage.actors(tenant_id,actor_id,host_subject,role,state,last_policy_version) VALUES($1,$2,$2,'admin','enabled','1')",[current.tenantId,current.actorId]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
