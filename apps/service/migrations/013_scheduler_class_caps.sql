CREATE OR REPLACE FUNCTION storage.claim_next_job(p_worker_id text,p_lease_seconds integer,p_global_cap integer)
RETURNS TABLE(id text,tenant_id text,actor_id text,backend_key text,kind text,request_id text,execution_id text,fence bigint,lease_until timestamptz,attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,storage AS $$
DECLARE
  candidate storage.jobs%ROWTYPE;
  chosen_slot integer;
  tenant_cap integer;
  backend_cap integer;
  class_cap integer;
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
    AND (SELECT count(*) FROM storage.capacity_leases l WHERE l.scope_type='global' AND l.scope_id=CASE WHEN j.kind='generation' THEN 'generation' ELSE 'execution' END)
      < LEAST(p_global_cap,CASE WHEN j.kind='generation' THEN 2 ELSE 4 END)
    AND (SELECT count(*) FROM storage.capacity_leases l WHERE l.scope_type='tenant' AND l.scope_id=j.tenant_id||':'||CASE WHEN j.kind='generation' THEN 'generation' ELSE 'execution' END)
      < CASE WHEN j.kind='generation' THEN 1 ELSE 2 END
    AND (j.kind='generation' OR (SELECT count(*) FROM storage.capacity_leases l WHERE l.scope_type='backend' AND l.scope_id=j.backend_key)<LEAST(bc.cap,2))
  ORDER BY st.next_turn,j.next_attempt_at,j.created_at FOR UPDATE OF st,j SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  capacity_class=CASE WHEN candidate.kind='generation' THEN 'generation' ELSE 'execution' END;
  class_cap=LEAST(p_global_cap,CASE WHEN candidate.kind='generation' THEN 2 ELSE 4 END);
  global_scope=capacity_class;
  tenant_scope=candidate.tenant_id||':'||capacity_class;
  SELECT s INTO chosen_slot FROM generate_series(1,class_cap) s WHERE NOT EXISTS(
    SELECT 1 FROM storage.capacity_leases l WHERE l.scope_type='global' AND l.scope_id=global_scope AND l.slot=s) ORDER BY s LIMIT 1;
  INSERT INTO storage.capacity_leases VALUES('global',global_scope,chosen_slot,candidate.id,p_worker_id,clock_timestamp()+make_interval(secs=>p_lease_seconds),candidate.fence+1);

  tenant_cap=CASE WHEN capacity_class='generation' THEN 1 ELSE 2 END;
  SELECT s INTO chosen_slot FROM generate_series(1,tenant_cap) s WHERE NOT EXISTS(
    SELECT 1 FROM storage.capacity_leases l WHERE l.scope_type='tenant' AND l.scope_id=tenant_scope AND l.slot=s) ORDER BY s LIMIT 1;
  INSERT INTO storage.capacity_leases VALUES('tenant',tenant_scope,chosen_slot,candidate.id,p_worker_id,clock_timestamp()+make_interval(secs=>p_lease_seconds),candidate.fence+1);

  IF capacity_class='execution' THEN
    SELECT LEAST(cap,2) INTO backend_cap FROM storage.backend_capacity bc WHERE bc.backend_key=candidate.backend_key;
    SELECT s INTO chosen_slot FROM generate_series(1,backend_cap) s WHERE NOT EXISTS(
      SELECT 1 FROM storage.capacity_leases l WHERE l.scope_type='backend' AND l.scope_id=candidate.backend_key AND l.slot=s) ORDER BY s LIMIT 1;
    INSERT INTO storage.capacity_leases VALUES('backend',candidate.backend_key,chosen_slot,candidate.id,p_worker_id,clock_timestamp()+make_interval(secs=>p_lease_seconds),candidate.fence+1);
  END IF;

  UPDATE storage.jobs SET status='leased',lease_owner=p_worker_id,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    fence=storage.jobs.fence+1,attempt_count=storage.jobs.attempt_count+1,updated_at=clock_timestamp() WHERE storage.jobs.id=candidate.id;
  UPDATE storage.scheduler_tenants SET next_turn=clock_timestamp()+interval '1 millisecond' WHERE scheduler_tenants.tenant_id=candidate.tenant_id;
  RETURN QUERY SELECT j.id,j.tenant_id,j.actor_id,j.backend_key,j.kind,j.request_id,j.execution_id,j.fence,j.lease_until,j.attempt_count FROM storage.jobs j WHERE j.id=candidate.id;
END $$;
