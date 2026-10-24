CREATE TABLE storage.generation_reservations (
  tenant_id text NOT NULL,id text NOT NULL,actor_id text NOT NULL,request_id text NOT NULL,
  intent_hash text NOT NULL CHECK(intent_hash ~ '^[a-f0-9]{64}$'),contract_version text NOT NULL,provider text NOT NULL,model text NOT NULL,
  status text NOT NULL CHECK(status IN('pending','running','completed','failed')),fence bigint NOT NULL DEFAULT 1 CHECK(fence>0),
  attempt_count integer NOT NULL DEFAULT 1 CHECK(attempt_count BETWEEN 1 AND 3),max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 3),
  token_budget bigint NOT NULL CHECK(token_budget>=0),cost_budget_micros bigint NOT NULL CHECK(cost_budget_micros>=0),
  reserved_cost_micros bigint NOT NULL DEFAULT 0 CHECK(reserved_cost_micros>=0),used_tokens bigint NOT NULL DEFAULT 0 CHECK(used_tokens>=0),
  used_cost_micros bigint NOT NULL DEFAULT 0 CHECK(used_cost_micros>=0),lease_owner text,lease_until timestamptz,artifact_id text,
  retryable boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,intent_hash,contract_version),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES storage.actors(tenant_id,actor_id),
  FOREIGN KEY(tenant_id,request_id) REFERENCES storage.requests(tenant_id,id),FOREIGN KEY(artifact_id) REFERENCES storage.recipe_artifacts(id)
);
ALTER TABLE storage.generation_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.generation_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY generation_reservations_private ON storage.generation_reservations USING(tenant_id=storage.current_tenant_id() AND actor_id=storage.current_actor_id()) WITH CHECK(tenant_id=storage.current_tenant_id() AND actor_id=storage.current_actor_id());

CREATE TABLE storage.usage_daily (
  tenant_id text NOT NULL,usage_day date NOT NULL,generation_calls bigint NOT NULL DEFAULT 0,input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,estimated_cost_micros bigint NOT NULL DEFAULT 0,billed_cost_micros bigint NOT NULL DEFAULT 0,
  db_queries bigint NOT NULL DEFAULT 0,backend_calls bigint NOT NULL DEFAULT 0,persisted_bytes bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(tenant_id,usage_day),FOREIGN KEY(tenant_id) REFERENCES storage.tenants(id)
);
ALTER TABLE storage.usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.usage_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_daily_tenant ON storage.usage_daily USING(tenant_id=storage.current_tenant_id()) WITH CHECK(tenant_id=storage.current_tenant_id());

CREATE FUNCTION storage.enqueue_job(p_id text,p_tenant_id text,p_actor_id text,p_backend_key text,p_request_id text,p_execution_id text,p_kind text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,storage AS $$
DECLARE tenant_pending integer;global_pending integer;
BEGIN
  IF p_tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'') OR p_actor_id IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'') THEN RAISE EXCEPTION 'job scope mismatch'; END IF;
  IF p_kind NOT IN('generation','execution','reconcile') THEN RAISE EXCEPTION 'invalid job kind'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('changedesk.jobs.admission.v1'));
  SELECT count(*) INTO tenant_pending FROM storage.jobs WHERE tenant_id=p_tenant_id AND status='pending';
  IF tenant_pending>=100 THEN RETURN 'tenant_full'; END IF;
  SELECT count(*) INTO global_pending FROM storage.jobs WHERE status='pending';
  IF global_pending>=1000 THEN RETURN 'global_full'; END IF;
  INSERT INTO storage.jobs(id,tenant_id,actor_id,backend_key,request_id,execution_id,kind,status) VALUES(p_id,p_tenant_id,p_actor_id,p_backend_key,p_request_id,p_execution_id,p_kind,'pending')
    ON CONFLICT(tenant_id,execution_id,kind) WHERE execution_id IS NOT NULL DO NOTHING;
  RETURN 'admitted';
END $$;
REVOKE ALL ON FUNCTION storage.enqueue_job(text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage.enqueue_job(text,text,text,text,text,text,text) TO changedesk_runtime,changedesk_worker;
GRANT SELECT,INSERT,UPDATE ON storage.generation_reservations,storage.usage_daily TO changedesk_runtime,changedesk_worker;
