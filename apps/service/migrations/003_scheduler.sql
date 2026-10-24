CREATE FUNCTION storage.claim_next_job(
  p_worker_id text,
  p_lease_seconds integer,
  p_global_cap integer
) RETURNS TABLE (
  id text, tenant_id text, backend_key text, kind text, request_id text,
  execution_id text, fence bigint, lease_until timestamptz, attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storage
AS $$
DECLARE
  candidate storage.jobs%ROWTYPE;
  chosen_slot integer;
  tenant_cap integer;
  backend_cap integer;
BEGIN
  IF p_worker_id = '' OR p_lease_seconds < 1 OR p_lease_seconds > 300 OR p_global_cap < 1 OR p_global_cap > 100 THEN
    RAISE EXCEPTION 'invalid scheduler claim parameters';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('changedesk.scheduler.capacity.v1'));
  DELETE FROM storage.capacity_leases WHERE capacity_leases.lease_until <= clock_timestamp();

  SELECT j.* INTO candidate
  FROM storage.scheduler_tenants st
  JOIN storage.jobs j ON j.tenant_id = st.tenant_id
  JOIN storage.backend_capacity bc ON bc.backend_key = j.backend_key
  WHERE j.status = 'pending' AND j.next_attempt_at <= clock_timestamp()
    AND (SELECT count(*) FROM storage.capacity_leases l WHERE l.scope_type = 'global' AND l.scope_id = 'deployment') < p_global_cap
    AND (SELECT count(*) FROM storage.capacity_leases l WHERE l.scope_type = 'tenant' AND l.scope_id = j.tenant_id) < st.cap
    AND (SELECT count(*) FROM storage.capacity_leases l WHERE l.scope_type = 'backend' AND l.scope_id = j.backend_key) < bc.cap
  ORDER BY st.next_turn, j.next_attempt_at, j.created_at
  FOR UPDATE OF st, j SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT s INTO chosen_slot FROM generate_series(1, p_global_cap) s
  WHERE NOT EXISTS (SELECT 1 FROM storage.capacity_leases l WHERE l.scope_type = 'global' AND l.scope_id = 'deployment' AND l.slot = s)
  ORDER BY s LIMIT 1;
  INSERT INTO storage.capacity_leases VALUES ('global', 'deployment', chosen_slot, candidate.id, p_worker_id, clock_timestamp() + make_interval(secs => p_lease_seconds), candidate.fence + 1);

  SELECT cap INTO tenant_cap FROM storage.scheduler_tenants WHERE scheduler_tenants.tenant_id = candidate.tenant_id;
  SELECT s INTO chosen_slot FROM generate_series(1, tenant_cap) s
  WHERE NOT EXISTS (SELECT 1 FROM storage.capacity_leases l WHERE l.scope_type = 'tenant' AND l.scope_id = candidate.tenant_id AND l.slot = s)
  ORDER BY s LIMIT 1;
  INSERT INTO storage.capacity_leases VALUES ('tenant', candidate.tenant_id, chosen_slot, candidate.id, p_worker_id, clock_timestamp() + make_interval(secs => p_lease_seconds), candidate.fence + 1);

  SELECT cap INTO backend_cap FROM storage.backend_capacity WHERE backend_capacity.backend_key = candidate.backend_key;
  SELECT s INTO chosen_slot FROM generate_series(1, backend_cap) s
  WHERE NOT EXISTS (SELECT 1 FROM storage.capacity_leases l WHERE l.scope_type = 'backend' AND l.scope_id = candidate.backend_key AND l.slot = s)
  ORDER BY s LIMIT 1;
  INSERT INTO storage.capacity_leases VALUES ('backend', candidate.backend_key, chosen_slot, candidate.id, p_worker_id, clock_timestamp() + make_interval(secs => p_lease_seconds), candidate.fence + 1);

  UPDATE storage.jobs SET status = 'leased', lease_owner = p_worker_id,
    lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
    fence = storage.jobs.fence + 1, attempt_count = storage.jobs.attempt_count + 1, updated_at = clock_timestamp()
  WHERE storage.jobs.id = candidate.id;
  UPDATE storage.scheduler_tenants SET next_turn = clock_timestamp() + interval '1 millisecond'
  WHERE scheduler_tenants.tenant_id = candidate.tenant_id;

  RETURN QUERY SELECT j.id, j.tenant_id, j.backend_key, j.kind, j.request_id, j.execution_id, j.fence, j.lease_until, j.attempt_count
  FROM storage.jobs j WHERE j.id = candidate.id;
END;
$$;

CREATE FUNCTION storage.ensure_scheduler_tenant(p_tenant_id text, p_backend_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storage
AS $$
BEGIN
  IF p_tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '') THEN
    RAISE EXCEPTION 'tenant scope mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.tenants t WHERE t.id=p_tenant_id AND t.backend_key=p_backend_key) THEN
    RAISE EXCEPTION 'unknown tenant backend';
  END IF;
  INSERT INTO storage.scheduler_tenants (tenant_id) VALUES (p_tenant_id) ON CONFLICT DO NOTHING;
  INSERT INTO storage.backend_capacity (backend_key) VALUES (p_backend_key) ON CONFLICT DO NOTHING;
END;
$$;

CREATE FUNCTION storage.heartbeat_job(p_job_id text, p_worker_id text, p_fence bigint, p_lease_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storage
AS $$
DECLARE updated_count integer;
BEGIN
  IF p_lease_seconds < 1 OR p_lease_seconds > 300 THEN RAISE EXCEPTION 'invalid lease duration'; END IF;
  UPDATE storage.jobs SET lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds), updated_at = clock_timestamp()
  WHERE id = p_job_id AND status = 'leased' AND lease_owner = p_worker_id AND fence = p_fence AND lease_until > clock_timestamp();
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count = 1 THEN
    UPDATE storage.capacity_leases SET lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
    WHERE job_id = p_job_id AND owner = p_worker_id AND fence = p_fence;
  END IF;
  RETURN updated_count = 1;
END;
$$;

CREATE FUNCTION storage.finish_job(p_job_id text, p_worker_id text, p_fence bigint, p_status text, p_next_attempt_at timestamptz, p_error_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storage
AS $$
DECLARE updated_count integer;
BEGIN
  IF p_status NOT IN ('pending', 'completed', 'failed', 'cancelled') THEN RAISE EXCEPTION 'invalid terminal job status'; END IF;
  UPDATE storage.jobs SET status = p_status, next_attempt_at = COALESCE(p_next_attempt_at, next_attempt_at),
    lease_owner = NULL, lease_until = NULL, last_error_code = p_error_code, updated_at = clock_timestamp()
  WHERE id = p_job_id AND status = 'leased' AND lease_owner = p_worker_id AND fence = p_fence;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count = 1 THEN DELETE FROM storage.capacity_leases WHERE job_id = p_job_id AND owner = p_worker_id AND fence = p_fence; END IF;
  RETURN updated_count = 1;
END;
$$;

CREATE FUNCTION storage.recover_expired_jobs(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, storage
AS $$
DECLARE recovered integer;
BEGIN
  IF p_limit < 1 OR p_limit > 1000 THEN RAISE EXCEPTION 'invalid recovery limit'; END IF;
  WITH expired AS (
    SELECT id FROM storage.jobs WHERE status = 'leased' AND lease_until <= clock_timestamp()
    ORDER BY lease_until FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), recovered_jobs AS (
    UPDATE storage.jobs j SET status = 'pending', kind = CASE WHEN j.kind = 'generation' THEN 'generation' ELSE 'reconcile' END,
      next_attempt_at = clock_timestamp(), lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
    FROM expired WHERE j.id = expired.id RETURNING j.id
  )
  SELECT count(*) INTO recovered FROM recovered_jobs;
  DELETE FROM storage.capacity_leases WHERE lease_until <= clock_timestamp();
  RETURN recovered;
END;
$$;

REVOKE ALL ON FUNCTION storage.claim_next_job(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION storage.ensure_scheduler_tenant(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION storage.heartbeat_job(text, text, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION storage.finish_job(text, text, bigint, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION storage.recover_expired_jobs(integer) FROM PUBLIC;
GRANT USAGE ON SCHEMA storage TO changedesk_worker;
GRANT EXECUTE ON FUNCTION storage.claim_next_job(text, integer, integer),
  storage.heartbeat_job(text, text, bigint, integer),
  storage.finish_job(text, text, bigint, text, timestamptz, text),
  storage.recover_expired_jobs(integer)
  TO changedesk_worker;
GRANT EXECUTE ON FUNCTION storage.ensure_scheduler_tenant(text, text) TO changedesk_runtime;
