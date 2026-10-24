ALTER TABLE storage.approvals ADD COLUMN host_session_id text;
ALTER TABLE storage.approvals ADD CONSTRAINT approvals_host_session_fk
  FOREIGN KEY(tenant_id,host_session_id) REFERENCES storage.sessions(tenant_id,id);

CREATE OR REPLACE FUNCTION storage.protect_approval() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,storage AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.id,NEW.plan_id,NEW.plan_version,NEW.plan_hash,NEW.actor_id,NEW.host_session_id,NEW.scope,NEW.expires_at,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.plan_id,OLD.plan_version,OLD.plan_hash,OLD.actor_id,OLD.host_session_id,OLD.scope,OLD.expires_at,OLD.created_at)
    OR (OLD.consumed_execution_id IS NOT NULL AND NEW.consumed_execution_id IS DISTINCT FROM OLD.consumed_execution_id) THEN
    RAISE EXCEPTION 'approval is immutable';
  END IF;
  IF NEW.consumed_execution_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM storage.executions e WHERE e.tenant_id=NEW.tenant_id AND e.id=NEW.consumed_execution_id
      AND e.approval_id=NEW.id AND e.plan_id=NEW.plan_id AND e.plan_version=NEW.plan_version
  ) THEN RAISE EXCEPTION 'approval consumption mismatch'; END IF;
  RETURN NEW;
END $$;
