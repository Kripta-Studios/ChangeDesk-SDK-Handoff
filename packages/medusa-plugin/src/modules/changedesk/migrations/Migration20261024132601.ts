import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261024132601 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "changedesk_operation_receipt" drop constraint if exists "changedesk_operation_receipt_tenant_id_operation_key_unique";`)
    this.addSql(`alter table if exists "changedesk_delegation_nonce" drop constraint if exists "changedesk_delegation_nonce_jti_unique";`)
    this.addSql(`create table if not exists "changedesk_delegation_nonce" ("id" text not null, "jti" text not null, "expires_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "changedesk_delegation_nonce_pkey" primary key ("id"));`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_changedesk_delegation_nonce_deleted_at" ON "changedesk_delegation_nonce" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_changedesk_delegation_nonce_jti_unique" ON "changedesk_delegation_nonce" ("jti") WHERE deleted_at IS NULL;`)

    this.addSql(`create table if not exists "changedesk_operation_receipt" ("id" text not null, "tenant_id" text not null, "operation_key" text not null, "actor_id" text not null, "execution_id" text not null, "row_id" text not null, "step_id" text not null, "product_id" text not null, "destination_id" text not null, "capability" text not null, "args_hash" text not null, "semantic_input_hash" text not null, "fence" integer not null, "status" text check ("status" in ('intent_recorded', 'sent', 'confirmed', 'no_effect', 'rejected', 'unknown')) not null, "readback" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "changedesk_operation_receipt_pkey" primary key ("id"));`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_changedesk_operation_receipt_deleted_at" ON "changedesk_operation_receipt" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_changedesk_operation_receipt_tenant_id_operation_key_unique" ON "changedesk_operation_receipt" ("tenant_id", "operation_key") WHERE deleted_at IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "changedesk_delegation_nonce" cascade;`)
    this.addSql(`drop table if exists "changedesk_operation_receipt" cascade;`)
  }
}
