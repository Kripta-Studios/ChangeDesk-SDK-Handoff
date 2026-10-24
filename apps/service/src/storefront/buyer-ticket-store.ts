import { createHash } from "node:crypto";
import type { StorefrontPool } from "./postgres-repository.js";
import type { StorefrontTicketReplayStore } from "./session.js";

export class PostgresBuyerTicketReplayStore implements StorefrontTicketReplayStore {
  constructor(private readonly pool: StorefrontPool) {}
  async consumeTicket(input: Parameters<StorefrontTicketReplayStore["consumeTicket"]>[0]): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id','',true),set_config('app.storefront_buyer_id',$2,true),set_config('app.storefront_staff_actor_id','',true)", [input.tenantId, input.buyerId]);
      const result = await client.query(
        `INSERT INTO storage.storefront_session_tickets(tenant_id,id,buyer_id,issuer,jti_hash,audience,expires_at)
         SELECT $1,$2,$3,$4,$5,$6,$7 WHERE $7 > clock_timestamp()
         ON CONFLICT DO NOTHING RETURNING id`,
        [input.tenantId, input.ticketId, input.buyerId, input.issuer, createHash("sha256").update(input.jti).digest("hex"), input.audience, input.expiresAt],
      );
      await client.query("COMMIT"); return result.rowCount === 1;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
