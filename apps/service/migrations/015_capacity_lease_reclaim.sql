CREATE OR REPLACE FUNCTION storage.recover_expired_jobs(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,storage
AS $$
DECLARE
  recovered_ids text[] := ARRAY[]::text[];
BEGIN
  IF p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'invalid recovery limit'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('changedesk.scheduler.capacity.v1'));

  WITH expired AS (
    SELECT id FROM storage.jobs WHERE status='leased' AND lease_until<=clock_timestamp()
    ORDER BY lease_until FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), recovered_jobs AS (
    UPDATE storage.jobs j SET status='pending',kind=CASE WHEN j.kind='generation' THEN 'generation' ELSE 'reconcile' END,
      next_attempt_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp()
    FROM expired WHERE j.id=expired.id RETURNING j.id
  )
  SELECT COALESCE(array_agg(id),ARRAY[]::text[]) INTO recovered_ids FROM recovered_jobs;

  DELETE FROM storage.capacity_leases WHERE job_id=ANY(recovered_ids);
  DELETE FROM storage.capacity_leases WHERE lease_until<=clock_timestamp();
  RETURN cardinality(recovered_ids);
END;
$$;

REVOKE ALL ON FUNCTION storage.recover_expired_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage.recover_expired_jobs(integer) TO changedesk_worker;
