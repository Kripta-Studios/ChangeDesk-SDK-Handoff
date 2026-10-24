CREATE POLICY actors_migrator_backfill ON storage.actors FOR SELECT TO changedesk_migrator USING (true);

ALTER TABLE storage.jobs ADD COLUMN actor_id text;
UPDATE storage.jobs j SET actor_id=COALESCE(
  (SELECT r.actor_id FROM storage.requests r WHERE r.tenant_id=j.tenant_id AND r.id=j.request_id),
  (SELECT e.actor_id FROM storage.executions e WHERE e.tenant_id=j.tenant_id AND e.id=j.execution_id)
);
ALTER TABLE storage.jobs ALTER COLUMN actor_id SET NOT NULL;
ALTER TABLE storage.jobs ADD CONSTRAINT jobs_actor_fk FOREIGN KEY(tenant_id,actor_id) REFERENCES storage.actors(tenant_id,actor_id);

DROP FUNCTION storage.claim_next_job(text,integer,integer);
CREATE FUNCTION storage.claim_next_job(p_worker_id text,p_lease_seconds integer,p_global_cap integer)
RETURNS TABLE(id text,tenant_id text,actor_id text,backend_key text,kind text,request_id text,execution_id text,fence bigint,lease_until timestamptz,attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,storage AS $$
DECLARE
  candidate storage.jobs%ROWTYPE;
  chosen_slot integer;
  tenant_cap integer;
  backend_cap integer;
  capacity_class text;
  global_scope text;
  tenant_scope text;
BEGIN
  IF p_worker_id='' OR p_lease_seconds<1 OR p_lease_seconds>300 OR p_global_cap<1 OR p_global_cap>100 THEN RAISE EXCEPTION 'invalid scheduler claim parameters'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('changedesk.scheduler.capacity.v1'));
  DELETE FROM storage.capacity_leases WHERE capacity_leases.lease_until<=clock_timestamp();

  SELECT j.* INTO candidate FROM storage.scheduler_tenants st
  JOIN storage.jobs j ON j.tenant_id=st.tenant_id
  JOIN storage.backend_capacity bc ON bc.backend_key=j.backend_key
  WHERE j.status='pending' AND j.next_attempt_at<=clock_timestamp()
    AND (SELECT count(*) FROM storage.capacity_leases l WHERE l.scope_type='global' AND l.scope_id=CASE WHEN j.kind='generation' THEN 'generation' ELSE 'execution' END)<p_global_cap
    AND (SELECT count(*) FROM storage.capacity_leases l WHERE l.scope_type='tenant' AND l.scope_id=j.tenant_id||':'||CASE WHEN j.kind='generation' THEN 'generation' ELSE 'execution' END)<st.cap
    AND (j.kind='generation' OR (SELECT count(*) FROM storage.capacity_leases l WHERE l.scope_type='backend' AND l.scope_id=j.backend_key)<bc.cap)
  ORDER BY st.next_turn,j.next_attempt_at,j.created_at FOR UPDATE OF st,j SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  capacity_class=CASE WHEN candidate.kind='generation' THEN 'generation' ELSE 'execution' END;
  global_scope=capacity_class;
  tenant_scope=candidate.tenant_id||':'||capacity_class;
  SELECT s INTO chosen_slot FROM generate_series(1,p_global_cap) s WHERE NOT EXISTS(
    SELECT 1 FROM storage.capacity_leases l WHERE l.scope_type='global' AND l.scope_id=global_scope AND l.slot=s) ORDER BY s LIMIT 1;
  INSERT INTO storage.capacity_leases VALUES('global',global_scope,chosen_slot,candidate.id,p_worker_id,clock_timestamp()+make_interval(secs=>p_lease_seconds),candidate.fence+1);

  SELECT cap INTO tenant_cap FROM storage.scheduler_tenants st WHERE st.tenant_id=candidate.tenant_id;
  SELECT s INTO chosen_slot FROM generate_series(1,tenant_cap) s WHERE NOT EXISTS(
    SELECT 1 FROM storage.capacity_leases l WHERE l.scope_type='tenant' AND l.scope_id=tenant_scope AND l.slot=s) ORDER BY s LIMIT 1;
  INSERT INTO storage.capacity_leases VALUES('tenant',tenant_scope,chosen_slot,candidate.id,p_worker_id,clock_timestamp()+make_interval(secs=>p_lease_seconds),candidate.fence+1);

  IF capacity_class='execution' THEN
    SELECT cap INTO backend_cap FROM storage.backend_capacity bc WHERE bc.backend_key=candidate.backend_key;
    SELECT s INTO chosen_slot FROM generate_series(1,backend_cap) s WHERE NOT EXISTS(
      SELECT 1 FROM storage.capacity_leases l WHERE l.scope_type='backend' AND l.scope_id=candidate.backend_key AND l.slot=s) ORDER BY s LIMIT 1;
    INSERT INTO storage.capacity_leases VALUES('backend',candidate.backend_key,chosen_slot,candidate.id,p_worker_id,clock_timestamp()+make_interval(secs=>p_lease_seconds),candidate.fence+1);
  END IF;

  UPDATE storage.jobs SET status='leased',lease_owner=p_worker_id,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    fence=storage.jobs.fence+1,attempt_count=storage.jobs.attempt_count+1,updated_at=clock_timestamp() WHERE storage.jobs.id=candidate.id;
  UPDATE storage.scheduler_tenants SET next_turn=clock_timestamp()+interval '1 millisecond' WHERE scheduler_tenants.tenant_id=candidate.tenant_id;
  RETURN QUERY SELECT j.id,j.tenant_id,j.actor_id,j.backend_key,j.kind,j.request_id,j.execution_id,j.fence,j.lease_until,j.attempt_count FROM storage.jobs j WHERE j.id=candidate.id;
END $$;

CREATE OR REPLACE FUNCTION storage.finish_job(p_job_id text,p_worker_id text,p_fence bigint,p_status text,p_next_attempt_at timestamptz,p_error_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,storage AS $$
DECLARE updated_count integer;
BEGIN
  IF p_status NOT IN('pending','completed','failed','cancelled') THEN RAISE EXCEPTION 'invalid terminal job status'; END IF;
  UPDATE storage.jobs SET status=p_status,next_attempt_at=COALESCE(p_next_attempt_at,next_attempt_at),lease_owner=NULL,lease_until=NULL,
    last_error_code=p_error_code,updated_at=clock_timestamp()
  WHERE id=p_job_id AND status='leased' AND lease_owner=p_worker_id AND fence=p_fence AND lease_until>clock_timestamp();
  GET DIAGNOSTICS updated_count=ROW_COUNT;
  IF updated_count=1 THEN DELETE FROM storage.capacity_leases WHERE job_id=p_job_id AND owner=p_worker_id AND fence=p_fence; END IF;
  RETURN updated_count=1;
END $$;

REVOKE ALL ON FUNCTION storage.claim_next_job(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage.claim_next_job(text,integer,integer) TO changedesk_worker;
GRANT USAGE ON SCHEMA storage TO changedesk_worker;
GRANT SELECT,INSERT,UPDATE ON storage.tenants,storage.host_connections,storage.actors,storage.requests,storage.request_messages,
  storage.installations,storage.plans,storage.approvals,storage.executions,storage.execution_rows,storage.step_attempts,storage.jobs,
  storage.idempotency_records,storage.session_tickets,storage.sessions,storage.audit_events,storage.recipe_artifacts,storage.artifact_grants,
  storage.evidence_bundles,storage.signing_keys,storage.signing_key_secrets,storage.publications TO changedesk_worker;
GRANT EXECUTE ON FUNCTION storage.current_tenant_id(),storage.current_actor_id(),storage.ensure_scheduler_tenant(text,text) TO changedesk_worker;
