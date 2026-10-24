import { randomUUID } from "node:crypto";
import type {
  BuyerContext,
  RepositoryResult,
  StorefrontAdminContext,
  StorefrontAdminPreview,
  StorefrontOverrides,
  StorefrontPreferences,
  StorefrontProposal,
  StorefrontRepository,
} from "./types.js";

const DEFAULTS = { theme: "system", density: "comfortable", productLayout: "grid" } as const;
interface QueryResult<Row> { readonly rows: Row[]; readonly rowCount: number | null; }
interface PoolClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
  release(): void;
}
export interface StorefrontPool { connect(): Promise<PoolClient>; }
type Subject = { kind: "buyer" | "staff"; id: string };
type IdempotencyReplay<T> = { kind: "new" } | { kind: "replay"; value: T } | { kind: "conflict" };

export class PostgresStorefrontRepository implements StorefrontRepository {
  constructor(private readonly pool: StorefrontPool, private readonly createId: () => string = randomUUID) {}

  async getPreferences(context: BuyerContext): Promise<StorefrontPreferences> {
    return this.withBuyer(context, (tx) => getPreferencesTx(tx, context));
  }

  async replacePreferences(input: Parameters<StorefrontRepository["replacePreferences"]>[0]): Promise<RepositoryResult<StorefrontPreferences>> {
    return this.withBuyer(input.context, async (tx) => {
      await lockIdempotency(tx, input.context.tenantId, { kind: "buyer", id: input.context.buyerId }, "preferences.replace", input.idempotencyKey);
      await lock(tx, `storefront:preferences:${input.context.tenantId}:${input.context.buyerId}`);
      const subject = { kind: "buyer", id: input.context.buyerId } as const;
      const replay = await readIdempotency<StorefrontPreferences>(tx, input.context.tenantId, subject, "preferences.replace", input.idempotencyKey, input.requestFingerprint);
      if (replay.kind === "replay") return { ok: true, value: replay.value, replayed: true };
      if (replay.kind === "conflict") return conflict("idempotency_key_reused");
      const current = await getPreferencesTx(tx, input.context, true);
      if (current.buyerRevision !== input.expectedRevision) return conflict("stale_buyer_revision");
      await tx.query(
        `INSERT INTO storage.storefront_buyer_preferences(tenant_id,buyer_id,overrides,buyer_revision)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(tenant_id,buyer_id) DO UPDATE SET overrides=EXCLUDED.overrides,buyer_revision=EXCLUDED.buyer_revision,updated_at=clock_timestamp()`,
        [input.context.tenantId, input.context.buyerId, input.overrides, current.buyerRevision + 1],
      );
      const value = await getPreferencesTx(tx, input.context);
      await writeIdempotency(tx, input.context.tenantId, subject, "preferences.replace", input.idempotencyKey, input.requestFingerprint, value);
      return { ok: true, value };
    });
  }

  async createProposal(input: Parameters<StorefrontRepository["createProposal"]>[0]): Promise<RepositoryResult<StorefrontProposal>> {
    try {
      return await this.withBuyer(input.context, async (tx) => {
        await lockIdempotency(tx, input.context.tenantId, { kind: "buyer", id: input.context.buyerId }, "proposals.create", input.idempotencyKey);
        await lock(tx, `storefront:global:${input.context.tenantId}`);
        await lock(tx, `storefront:proposal-create:${input.context.tenantId}:${input.context.buyerId}`);
        const subject = { kind: "buyer", id: input.context.buyerId } as const;
        const replay = await readIdempotency<StorefrontProposal>(tx, input.context.tenantId, subject, "proposals.create", input.idempotencyKey, input.requestFingerprint);
        if (replay.kind === "replay") return { ok: true, value: replay.value, replayed: true };
        if (replay.kind === "conflict") return conflict("idempotency_key_reused");
        const global = await readGlobal(tx, input.context.tenantId);
        if (global.revision !== input.baseGlobalRevision) return conflict("stale_global_revision");
        await tx.query("SELECT storage.storefront_admit_pending($1,$2)", [input.context.tenantId, input.context.buyerId]);
        const id = this.createId();
        const result = await tx.query<ProposalRow>(
          `INSERT INTO storage.storefront_global_proposals(tenant_id,id,buyer_id,base_global_revision,proposed)
           VALUES($1,$2,$3,$4,$5) RETURNING id::text,buyer_id,base_global_revision,proposed,status,proposal_revision,created_at,decided_at`,
          [input.context.tenantId, id, input.context.buyerId, input.baseGlobalRevision, input.proposed],
        );
        const value = proposal(result.rows[0]!, input.context.tenantId);
        await writeIdempotency(tx, input.context.tenantId, subject, "proposals.create", input.idempotencyKey, input.requestFingerprint, value);
        return { ok: true, value };
      });
    } catch (error) {
      if (isQuotaError(error)) return { ok: false, code: "quota", reason: "pending_proposal_quota" };
      throw error;
    }
  }

  async getBuyerProposal(context: BuyerContext, proposalId: string): Promise<RepositoryResult<StorefrontProposal>> {
    return this.withBuyer(context, async (tx) => {
      const result = await tx.query<ProposalRow>(`${PROPOSAL_SELECT} WHERE tenant_id=$1 AND id=$2::uuid`, [context.tenantId, proposalId]);
      return result.rowCount === 1 ? { ok: true, value: proposal(result.rows[0]!, context.tenantId) } : notFound();
    });
  }

  async listAdminProposals(context: StorefrontAdminContext): Promise<readonly StorefrontAdminPreview[]> {
    return this.withAdmin(context, async (tx) => {
      const global = await readGlobal(tx, context.tenantId);
      const result = await tx.query<ProposalRow>(`${PROPOSAL_SELECT} WHERE tenant_id=$1 AND status='pending' ORDER BY created_at ASC,id LIMIT 50`, [context.tenantId]);
      return result.rows.map((row) => preview(proposal(row, context.tenantId), global));
    });
  }

  async getAdminProposal(context: StorefrontAdminContext, proposalId: string): Promise<RepositoryResult<StorefrontAdminPreview>> {
    return this.withAdmin(context, async (tx) => {
      const result = await tx.query<ProposalRow>(`${PROPOSAL_SELECT} WHERE tenant_id=$1 AND id=$2::uuid`, [context.tenantId, proposalId]);
      if (result.rowCount !== 1) return notFound();
      return { ok: true, value: preview(proposal(result.rows[0]!, context.tenantId), await readGlobal(tx, context.tenantId)) };
    });
  }

  async approveProposal(input: Parameters<StorefrontRepository["approveProposal"]>[0]): Promise<RepositoryResult<StorefrontAdminPreview>> {
    return this.withAdmin(input.context, async (tx) => {
      await lockIdempotency(tx, input.context.tenantId, { kind: "staff", id: input.context.actorId }, "proposals.approve", input.idempotencyKey);
      await lock(tx, `storefront:global:${input.context.tenantId}`);
      const subject = { kind: "staff", id: input.context.actorId } as const;
      const replay = await readIdempotency<StorefrontAdminPreview>(tx, input.context.tenantId, subject, "proposals.approve", input.idempotencyKey, input.requestFingerprint);
      if (replay.kind === "replay") return { ok: true, value: replay.value, replayed: true };
      if (replay.kind === "conflict") return conflict("idempotency_key_reused");
      const selected = await tx.query<ProposalRow>(`${PROPOSAL_SELECT} WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE`, [input.context.tenantId, input.proposalId]);
      if (selected.rowCount !== 1) return notFound();
      const item = proposal(selected.rows[0]!, input.context.tenantId); const global = await readGlobal(tx, input.context.tenantId, true);
      if (item.status !== "pending" || item.proposalRevision !== input.expectedProposalRevision || global.revision !== input.expectedGlobalRevision || item.baseGlobalRevision !== global.revision) return conflict("stale_proposal");
      await tx.query(
        `INSERT INTO storage.storefront_globals(tenant_id,theme,density,product_layout,global_revision)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id) DO UPDATE SET theme=EXCLUDED.theme,density=EXCLUDED.density,product_layout=EXCLUDED.product_layout,global_revision=EXCLUDED.global_revision,updated_at=clock_timestamp()`,
        [input.context.tenantId, item.proposed.theme, item.proposed.density, item.proposed.productLayout, global.revision + 1],
      );
      await tx.query(`UPDATE storage.storefront_global_proposals SET status='approved',proposal_revision=proposal_revision+1,decided_at=clock_timestamp(),decided_by=$3 WHERE tenant_id=$1 AND id=$2::uuid`, [input.context.tenantId, item.id, input.context.actorId]);
      await tx.query(`INSERT INTO storage.storefront_decisions(tenant_id,proposal_id,proposal_revision,global_revision,decision,actor_id) VALUES($1,$2::uuid,$3,$4,'approved',$5)`, [input.context.tenantId, item.id, item.proposalRevision, global.revision + 1, input.context.actorId]);
      await tx.query("SELECT storage.storefront_release_pending($1,$2)", [input.context.tenantId, item.buyerId]);
      const value = preview({ ...item, status: "approved", proposalRevision: item.proposalRevision + 1 }, { values: item.proposed, revision: global.revision + 1 });
      await writeIdempotency(tx, input.context.tenantId, subject, "proposals.approve", input.idempotencyKey, input.requestFingerprint, value);
      return { ok: true, value };
    });
  }

  async rejectProposal(input: Parameters<StorefrontRepository["rejectProposal"]>[0]): Promise<RepositoryResult<StorefrontAdminPreview>> {
    return this.withAdmin(input.context, async (tx) => {
      await lockIdempotency(tx, input.context.tenantId, { kind: "staff", id: input.context.actorId }, "proposals.reject", input.idempotencyKey);
      await lock(tx, `storefront:proposal:${input.context.tenantId}:${input.proposalId}`);
      const subject = { kind: "staff", id: input.context.actorId } as const;
      const replay = await readIdempotency<StorefrontAdminPreview>(tx, input.context.tenantId, subject, "proposals.reject", input.idempotencyKey, input.requestFingerprint);
      if (replay.kind === "replay") return { ok: true, value: replay.value, replayed: true };
      if (replay.kind === "conflict") return conflict("idempotency_key_reused");
      const selected = await tx.query<ProposalRow>(`${PROPOSAL_SELECT} WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE`, [input.context.tenantId, input.proposalId]);
      if (selected.rowCount !== 1) return notFound();
      const item = proposal(selected.rows[0]!, input.context.tenantId);
      if (item.status !== "pending" || item.proposalRevision !== input.expectedProposalRevision) return conflict("stale_proposal");
      await tx.query(`UPDATE storage.storefront_global_proposals SET status='rejected',proposal_revision=proposal_revision+1,decided_at=clock_timestamp(),decided_by=$3 WHERE tenant_id=$1 AND id=$2::uuid`, [input.context.tenantId, item.id, input.context.actorId]);
      await tx.query(`INSERT INTO storage.storefront_decisions(tenant_id,proposal_id,proposal_revision,global_revision,decision,actor_id) VALUES($1,$2::uuid,$3,$4,'rejected',$5)`, [input.context.tenantId, item.id, item.proposalRevision, item.baseGlobalRevision, input.context.actorId]);
      await tx.query("SELECT storage.storefront_release_pending($1,$2)", [input.context.tenantId, item.buyerId]);
      const value = preview({ ...item, status: "rejected", proposalRevision: item.proposalRevision + 1 }, await readGlobal(tx, input.context.tenantId));
      await writeIdempotency(tx, input.context.tenantId, subject, "proposals.reject", input.idempotencyKey, input.requestFingerprint, value);
      return { ok: true, value };
    });
  }

  private async withBuyer<T>(context: BuyerContext, work: (tx: PoolClient) => Promise<T>): Promise<T> {
    return this.withContext(context.tenantId, context.buyerId, "", work);
  }
  private async withAdmin<T>(context: StorefrontAdminContext, work: (tx: PoolClient) => Promise<T>): Promise<T> {
    return this.withContext(context.tenantId, "", context.actorId, work);
  }
  private async withContext<T>(tenantId: string, buyerId: string, staffActorId: string, work: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id','',true),set_config('app.storefront_buyer_id',$2,true),set_config('app.storefront_staff_actor_id',$3,true)", [tenantId, buyerId, staffActorId]);
      const value = await work(tx); await tx.query("COMMIT"); return value;
    } catch (error) { await tx.query("ROLLBACK"); throw error; } finally { tx.release(); }
  }
}

const PROPOSAL_SELECT = `SELECT id::text,buyer_id,base_global_revision,proposed,status,proposal_revision,created_at,decided_at FROM storage.storefront_global_proposals`;
interface ProposalRow extends Record<string, unknown> { id: string; buyer_id: string; base_global_revision: string; proposed: Required<StorefrontOverrides>; status: StorefrontProposal["status"]; proposal_revision: string; created_at: Date; decided_at: Date | null; }
function proposal(row: ProposalRow, tenantId: string): StorefrontProposal { return { id: row.id, tenantId, buyerId: row.buyer_id, baseGlobalRevision: Number(row.base_global_revision), proposed: row.proposed, status: row.status, proposalRevision: Number(row.proposal_revision), createdAt: row.created_at.toISOString(), ...(row.decided_at ? { decidedAt: row.decided_at.toISOString() } : {}) }; }
interface GlobalState { values: Required<StorefrontOverrides>; revision: number; }
async function readGlobal(tx: PoolClient, tenantId: string, forUpdate = false): Promise<GlobalState> {
  const result = await tx.query<{theme:string;density:string;product_layout:string;global_revision:string}>(`SELECT theme,density,product_layout,global_revision FROM storage.storefront_globals WHERE tenant_id=$1${forUpdate ? " FOR UPDATE" : ""}`, [tenantId]);
  if (result.rowCount !== 1) return { values: DEFAULTS, revision: 0 };
  const row = result.rows[0]!; return { values: { theme: row.theme as Required<StorefrontOverrides>["theme"], density: row.density as Required<StorefrontOverrides>["density"], productLayout: row.product_layout as Required<StorefrontOverrides>["productLayout"] }, revision: Number(row.global_revision) };
}
async function getPreferencesTx(tx: PoolClient, context: BuyerContext, forUpdate = false): Promise<StorefrontPreferences> {
  const global = await readGlobal(tx, context.tenantId);
  const result = await tx.query<{overrides:StorefrontOverrides;buyer_revision:string}>(`SELECT overrides,buyer_revision FROM storage.storefront_buyer_preferences WHERE tenant_id=$1 AND buyer_id=$2${forUpdate ? " FOR UPDATE" : ""}`, [context.tenantId, context.buyerId]);
  const overrides = result.rows[0]?.overrides ?? {}; const buyerRevision = Number(result.rows[0]?.buyer_revision ?? 0);
  return { overrides, inherited: global.values, effective: { ...global.values, ...overrides }, buyerRevision, globalRevision: global.revision };
}
function preview(item: StorefrontProposal, global: GlobalState): StorefrontAdminPreview { return { proposalId: item.id, proposalRevision: item.proposalRevision, current: global.values, proposed: item.proposed, globalRevision: global.revision, precedenceNotice: "Personal overrides remain unchanged and take precedence.", status: item.status }; }
async function lock(tx: PoolClient, key: string): Promise<void> { await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]); }
async function lockIdempotency(tx: PoolClient, tenantId: string, subject: Subject, operation: string, key: string): Promise<void> { await lock(tx, `storefront:idempotency:${tenantId}:${subject.kind}:${subject.id}:${operation}:${key}`); }
async function readIdempotency<T>(tx: PoolClient, tenantId: string, subject: Subject, operation: string, key: string, fingerprint: string): Promise<IdempotencyReplay<T>> {
  const result = await tx.query<{request_fingerprint:string;response_body:T}>(`SELECT request_fingerprint,response_body FROM storage.storefront_idempotency WHERE tenant_id=$1 AND subject_kind=$2 AND subject_id=$3 AND operation=$4 AND idempotency_key=$5::uuid`, [tenantId, subject.kind, subject.id, operation, key]);
  if (result.rowCount !== 1) return { kind: "new" }; const row = result.rows[0]!; return row.request_fingerprint === fingerprint ? { kind: "replay", value: row.response_body } : { kind: "conflict" };
}
async function writeIdempotency(tx: PoolClient, tenantId: string, subject: Subject, operation: string, key: string, fingerprint: string, value: unknown): Promise<void> {
  await tx.query(`INSERT INTO storage.storefront_idempotency(tenant_id,subject_kind,subject_id,operation,idempotency_key,request_fingerprint,response_body) VALUES($1,$2,$3,$4,$5::uuid,$6,$7)`, [tenantId, subject.kind, subject.id, operation, key, fingerprint, value]);
}
function conflict(reason: string): RepositoryResult<never> { return { ok: false, code: "conflict", reason }; }
function notFound(): RepositoryResult<never> { return { ok: false, code: "not_found", reason: "proposal_not_found" }; }
function isQuotaError(error: unknown): boolean { return typeof error === "object" && error !== null && "message" in error && String((error as {message:unknown}).message).startsWith("storefront_") && String((error as {message:unknown}).message).endsWith("_quota"); }
