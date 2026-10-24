CREATE FUNCTION storage.current_tenant_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '') $$;

CREATE FUNCTION storage.current_actor_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.actor_id', true), '') $$;

REVOKE ALL ON FUNCTION storage.current_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION storage.current_actor_id() FROM PUBLIC;

CREATE FUNCTION storage.protect_approval() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,storage AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.id,NEW.plan_id,NEW.plan_version,NEW.plan_hash,NEW.actor_id,NEW.scope,NEW.expires_at,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.plan_id,OLD.plan_version,OLD.plan_hash,OLD.actor_id,OLD.scope,OLD.expires_at,OLD.created_at)
    OR (OLD.consumed_execution_id IS NOT NULL AND NEW.consumed_execution_id IS DISTINCT FROM OLD.consumed_execution_id) THEN
    RAISE EXCEPTION 'approval is immutable';
  END IF;
  IF NEW.consumed_execution_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM storage.executions e WHERE e.tenant_id=NEW.tenant_id AND e.id=NEW.consumed_execution_id
      AND e.approval_id=NEW.id AND e.plan_id=NEW.plan_id AND e.plan_version=NEW.plan_version
  ) THEN RAISE EXCEPTION 'approval consumption mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approvals_immutable BEFORE UPDATE ON storage.approvals FOR EACH ROW EXECUTE FUNCTION storage.protect_approval();

CREATE FUNCTION storage.protect_plan() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,storage AS $$
BEGIN
  IF OLD.state='ready' AND NEW.state NOT IN ('ready','expired','superseded') THEN RAISE EXCEPTION 'invalid ready plan transition'; END IF;
  IF OLD.state IN ('rejected','expired','superseded') AND NEW.state<>OLD.state THEN RAISE EXCEPTION 'terminal plan state is immutable'; END IF;
  IF OLD.state IN ('ready','rejected','expired','superseded') AND ROW(NEW.tenant_id,NEW.id,NEW.request_id,NEW.installation_id,NEW.actor_id,NEW.artifact_hash,NEW.adapter_version,NEW.policy_version,NEW.capability_manifest_hash,NEW.body,NEW.plan_hash,NEW.plan_version,NEW.expires_at,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.request_id,OLD.installation_id,OLD.actor_id,OLD.artifact_hash,OLD.adapter_version,OLD.policy_version,OLD.capability_manifest_hash,OLD.body,OLD.plan_hash,OLD.plan_version,OLD.expires_at,OLD.created_at) THEN
    RAISE EXCEPTION 'materialized plan is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plans_materialized_immutable BEFORE UPDATE ON storage.plans FOR EACH ROW EXECUTE FUNCTION storage.protect_plan();

CREATE FUNCTION storage.protect_artifact() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,storage AS $$
BEGIN
  IF ROW(NEW.id,NEW.owner_tenant_id,NEW.artifact_hash,NEW.schema_version,NEW.canonical_body,NEW.signature_ref,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.owner_tenant_id,OLD.artifact_hash,OLD.schema_version,OLD.canonical_body,OLD.signature_ref,OLD.created_at) THEN
    RAISE EXCEPTION 'artifact content is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artifact_content_immutable BEFORE UPDATE ON storage.recipe_artifacts FOR EACH ROW EXECUTE FUNCTION storage.protect_artifact();

CREATE FUNCTION storage.protect_installation_pin() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,storage AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.id,NEW.artifact_id,NEW.artifact_hash,NEW.config,NEW.installed_by,NEW.policy_version,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.artifact_id,OLD.artifact_hash,OLD.config,OLD.installed_by,OLD.policy_version,OLD.created_at) THEN
    RAISE EXCEPTION 'installation version is pinned';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER installation_pin_immutable BEFORE UPDATE ON storage.installations FOR EACH ROW EXECUTE FUNCTION storage.protect_installation_pin();

ALTER TABLE storage.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON storage.tenants USING (id = storage.current_tenant_id());

ALTER TABLE storage.host_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.host_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY host_connections_tenant ON storage.host_connections USING (tenant_id = storage.current_tenant_id()) WITH CHECK (tenant_id = storage.current_tenant_id());

ALTER TABLE storage.actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.actors FORCE ROW LEVEL SECURITY;
CREATE POLICY actors_private ON storage.actors USING (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id()) WITH CHECK (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id());

ALTER TABLE storage.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.requests FORCE ROW LEVEL SECURITY;
CREATE POLICY requests_private ON storage.requests USING (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id()) WITH CHECK (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id());

ALTER TABLE storage.request_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.request_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY request_messages_private ON storage.request_messages USING (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id()) WITH CHECK (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id());

ALTER TABLE storage.installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.installations FORCE ROW LEVEL SECURITY;
CREATE POLICY installations_tenant ON storage.installations USING (tenant_id = storage.current_tenant_id()) WITH CHECK (tenant_id = storage.current_tenant_id());

ALTER TABLE storage.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.plans FORCE ROW LEVEL SECURITY;
CREATE POLICY plans_private ON storage.plans USING (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id()) WITH CHECK (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id());

ALTER TABLE storage.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY approvals_private ON storage.approvals USING (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id()) WITH CHECK (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id());

ALTER TABLE storage.executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.executions FORCE ROW LEVEL SECURITY;
CREATE POLICY executions_private ON storage.executions USING (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id()) WITH CHECK (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id());

ALTER TABLE storage.execution_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.execution_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY execution_rows_private ON storage.execution_rows USING (
  tenant_id = storage.current_tenant_id() AND EXISTS (
    SELECT 1 FROM storage.executions e WHERE e.tenant_id = execution_rows.tenant_id AND e.id = execution_rows.execution_id AND e.actor_id = storage.current_actor_id()
  )
) WITH CHECK (tenant_id = storage.current_tenant_id() AND EXISTS (
  SELECT 1 FROM storage.executions e WHERE e.tenant_id = execution_rows.tenant_id AND e.id = execution_rows.execution_id AND e.actor_id = storage.current_actor_id()
));

ALTER TABLE storage.step_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.step_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY step_attempts_private ON storage.step_attempts USING (
  tenant_id = storage.current_tenant_id() AND EXISTS (
    SELECT 1 FROM storage.executions e WHERE e.tenant_id = step_attempts.tenant_id AND e.id = step_attempts.execution_id AND e.actor_id = storage.current_actor_id()
  )
) WITH CHECK (tenant_id = storage.current_tenant_id() AND EXISTS (
  SELECT 1 FROM storage.executions e WHERE e.tenant_id = step_attempts.tenant_id AND e.id = step_attempts.execution_id AND e.actor_id = storage.current_actor_id()
));

ALTER TABLE storage.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY jobs_private ON storage.jobs USING (
  tenant_id = storage.current_tenant_id() AND (
    (request_id IS NOT NULL AND EXISTS (SELECT 1 FROM storage.requests r WHERE r.tenant_id=jobs.tenant_id AND r.id=jobs.request_id AND r.actor_id=storage.current_actor_id()))
    OR (execution_id IS NOT NULL AND EXISTS (SELECT 1 FROM storage.executions e WHERE e.tenant_id=jobs.tenant_id AND e.id=jobs.execution_id AND e.actor_id=storage.current_actor_id()))
  )
) WITH CHECK (
  tenant_id = storage.current_tenant_id() AND (
    (request_id IS NOT NULL AND EXISTS (SELECT 1 FROM storage.requests r WHERE r.tenant_id=jobs.tenant_id AND r.id=jobs.request_id AND r.actor_id=storage.current_actor_id()))
    OR (execution_id IS NOT NULL AND EXISTS (SELECT 1 FROM storage.executions e WHERE e.tenant_id=jobs.tenant_id AND e.id=jobs.execution_id AND e.actor_id=storage.current_actor_id()))
  )
);

ALTER TABLE storage.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_private ON storage.idempotency_records USING (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id()) WITH CHECK (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id());

ALTER TABLE storage.session_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.session_tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY tickets_private ON storage.session_tickets USING (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id()) WITH CHECK (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id());

ALTER TABLE storage.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_private ON storage.sessions USING (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id()) WITH CHECK (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id());

ALTER TABLE storage.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_private ON storage.audit_events USING (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id()) WITH CHECK (tenant_id = storage.current_tenant_id() AND actor_id = storage.current_actor_id());

ALTER TABLE storage.recipe_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.recipe_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY artifacts_visible ON storage.recipe_artifacts USING (
  owner_tenant_id = storage.current_tenant_id() OR EXISTS (
    SELECT 1 FROM storage.artifact_grants g WHERE g.artifact_id=recipe_artifacts.id
      AND g.recipient_tenant_id=storage.current_tenant_id()
      AND 'read'=ANY(g.rights)
      AND (g.expires_at IS NULL OR g.expires_at > clock_timestamp())
  )
) WITH CHECK (owner_tenant_id = storage.current_tenant_id());

ALTER TABLE storage.artifact_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.artifact_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY grants_visible ON storage.artifact_grants USING (
  (recipient_tenant_id = storage.current_tenant_id() AND 'read'=ANY(rights)) OR granted_by_tenant_id=storage.current_tenant_id()
) WITH CHECK (granted_by_tenant_id=storage.current_tenant_id() AND granted_by_actor_id=storage.current_actor_id());

ALTER TABLE storage.evidence_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.evidence_bundles FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_owner ON storage.evidence_bundles USING (owner_tenant_id = storage.current_tenant_id()) WITH CHECK (owner_tenant_id = storage.current_tenant_id());

ALTER TABLE storage.signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.signing_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY signing_keys_visible ON storage.signing_keys USING (
  owner_tenant_id = storage.current_tenant_id() OR EXISTS (
    SELECT 1 FROM storage.publications p WHERE p.signing_key_id=signing_keys.id AND p.state='published'
  )
) WITH CHECK (owner_tenant_id = storage.current_tenant_id());

ALTER TABLE storage.publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.publications FORCE ROW LEVEL SECURITY;
CREATE POLICY publications_visible ON storage.publications USING (
  publisher_tenant_id = storage.current_tenant_id() OR (
    state='published' AND EXISTS (SELECT 1 FROM storage.recipe_artifacts a WHERE a.id=publications.artifact_id)
  )
) WITH CHECK (publisher_tenant_id = storage.current_tenant_id() AND publisher_actor_id = storage.current_actor_id());

ALTER TABLE storage.signing_key_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.signing_key_secrets FORCE ROW LEVEL SECURITY;
CREATE POLICY signing_key_secrets_owner ON storage.signing_key_secrets USING (tenant_id=storage.current_tenant_id()) WITH CHECK (tenant_id=storage.current_tenant_id());

GRANT USAGE ON SCHEMA storage TO changedesk_runtime;
GRANT SELECT, INSERT, UPDATE ON storage.tenants, storage.host_connections, storage.actors, storage.requests,
  storage.request_messages, storage.installations, storage.plans, storage.approvals, storage.executions,
  storage.execution_rows, storage.step_attempts, storage.jobs, storage.idempotency_records,
  storage.session_tickets, storage.sessions, storage.audit_events, storage.recipe_artifacts,
  storage.artifact_grants, storage.evidence_bundles, storage.signing_keys, storage.signing_key_secrets, storage.publications
  TO changedesk_runtime;
GRANT EXECUTE ON FUNCTION storage.current_tenant_id(), storage.current_actor_id() TO changedesk_runtime;
