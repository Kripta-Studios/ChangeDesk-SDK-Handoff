CREATE TABLE storage.tenant_tombstones(
  tenant_id text PRIMARY KEY,deleted_at timestamptz NOT NULL DEFAULT clock_timestamp(),reason_code text NOT NULL,
  restore_generation bigint NOT NULL DEFAULT 1,applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON storage.tenant_tombstones FROM PUBLIC;

CREATE FUNCTION storage.tenant_not_tombstoned(p_tenant_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,storage
AS $$ SELECT NOT EXISTS(SELECT 1 FROM storage.tenant_tombstones d WHERE d.tenant_id=p_tenant_id) $$;
REVOKE ALL ON FUNCTION storage.tenant_not_tombstoned(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage.tenant_not_tombstoned(text) TO changedesk_runtime,changedesk_worker;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('host_connections','tenant_id'),('actors','tenant_id'),('requests','tenant_id'),('request_messages','tenant_id'),
    ('installations','tenant_id'),('plans','tenant_id'),('approvals','tenant_id'),('executions','tenant_id'),
    ('execution_rows','tenant_id'),('step_attempts','tenant_id'),('jobs','tenant_id'),('idempotency_records','tenant_id'),
    ('session_tickets','tenant_id'),('sessions','tenant_id'),('audit_events','tenant_id'),('capability_manifests','tenant_id'),
    ('request_candidates','tenant_id'),('generation_reservations','tenant_id'),('usage_daily','tenant_id'),('signing_key_secrets','tenant_id'),
    ('artifact_grants','granted_by_tenant_id')
  ) AS scoped(table_name,column_name)
  LOOP
    EXECUTE format('CREATE POLICY %I_tombstone_gate ON storage.%I AS RESTRICTIVE USING(storage.tenant_not_tombstoned(storage.current_tenant_id())) WITH CHECK(storage.tenant_not_tombstoned(storage.current_tenant_id()))',r.table_name,r.table_name);
  END LOOP;
END $$;
CREATE POLICY artifacts_tombstone_gate ON storage.recipe_artifacts AS RESTRICTIVE
  USING(storage.tenant_not_tombstoned(storage.current_tenant_id()))
  WITH CHECK(storage.tenant_not_tombstoned(storage.current_tenant_id()));
CREATE POLICY evidence_tombstone_gate ON storage.evidence_bundles AS RESTRICTIVE
  USING(storage.tenant_not_tombstoned(storage.current_tenant_id()))
  WITH CHECK(storage.tenant_not_tombstoned(storage.current_tenant_id()));
CREATE POLICY publications_tombstone_gate ON storage.publications AS RESTRICTIVE
  USING(storage.tenant_not_tombstoned(storage.current_tenant_id())) WITH CHECK(storage.tenant_not_tombstoned(storage.current_tenant_id()));
CREATE POLICY signing_keys_tombstone_gate ON storage.signing_keys AS RESTRICTIVE
  USING(storage.tenant_not_tombstoned(storage.current_tenant_id())) WITH CHECK(storage.tenant_not_tombstoned(storage.current_tenant_id()));

CREATE POLICY tenants_migrator_access ON storage.tenants TO changedesk_migrator USING(true) WITH CHECK(true);
CREATE FUNCTION storage.tombstone_current_tenant(p_reason_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,storage AS $$
DECLARE scoped_tenant text:=nullif(current_setting('app.tenant_id',true),'');
BEGIN
  IF scoped_tenant IS NULL OR p_reason_code='' THEN RAISE EXCEPTION 'invalid tombstone request'; END IF;
  UPDATE storage.jobs SET status='cancelled',lease_owner=NULL,lease_until=NULL WHERE tenant_id=scoped_tenant AND status IN('pending','leased');
  DELETE FROM storage.capacity_leases l USING storage.jobs j WHERE l.job_id=j.id AND j.tenant_id=scoped_tenant;
  UPDATE storage.tenants SET status='disabled' WHERE id=scoped_tenant;
  INSERT INTO storage.tenant_tombstones(tenant_id,reason_code) VALUES(scoped_tenant,p_reason_code)
    ON CONFLICT(tenant_id) DO UPDATE SET deleted_at=clock_timestamp(),reason_code=EXCLUDED.reason_code,
      restore_generation=storage.tenant_tombstones.restore_generation+1,applied_at=clock_timestamp();
END $$;
REVOKE ALL ON FUNCTION storage.tombstone_current_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage.tombstone_current_tenant(text) TO changedesk_runtime;

CREATE FUNCTION storage.reapply_tombstones() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,storage AS $$
DECLARE affected integer;
BEGIN
  UPDATE storage.tenants t SET status='disabled' FROM storage.tenant_tombstones d WHERE t.id=d.tenant_id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  UPDATE storage.tenant_tombstones SET applied_at=clock_timestamp();
  RETURN affected;
END $$;
REVOKE ALL ON FUNCTION storage.reapply_tombstones() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage.reapply_tombstones() TO changedesk_migrator;

CREATE FUNCTION storage.cleanup_tenant_retention(p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,storage AS $$
DECLARE scoped_tenant text:=nullif(current_setting('app.tenant_id',true),'');requests_cleaned integer;attempts_cleaned integer;usage_deleted integer;
BEGIN
  IF scoped_tenant IS NULL THEN RAISE EXCEPTION 'tenant scope required'; END IF;
  UPDATE storage.requests r SET redacted_text='[expired]',context_ref='{}'::jsonb,budget='{}'::jsonb,updated_at=clock_timestamp()
  WHERE r.tenant_id=scoped_tenant AND r.created_at<p_now-interval '7 days' AND NOT EXISTS(
    SELECT 1 FROM storage.plans p JOIN storage.executions e ON e.tenant_id=p.tenant_id AND e.plan_id=p.id
    LEFT JOIN storage.execution_rows er ON er.tenant_id=e.tenant_id AND er.execution_id=e.id
    LEFT JOIN storage.step_attempts sa ON sa.tenant_id=e.tenant_id AND sa.execution_id=e.id
    WHERE p.tenant_id=r.tenant_id AND p.request_id=r.id AND (er.state IN('unknown','needs_review') OR sa.state IN('sent','unknown'))
  );
  GET DIAGNOSTICS requests_cleaned=ROW_COUNT;
  UPDATE storage.request_messages m SET redacted_text='[expired]' WHERE m.tenant_id=scoped_tenant AND m.created_at<p_now-interval '7 days'
    AND EXISTS(SELECT 1 FROM storage.requests r WHERE r.tenant_id=m.tenant_id AND r.id=m.request_id AND r.redacted_text='[expired]');
  UPDATE storage.step_attempts sa SET receipt_ref=NULL,observation_ref=NULL,error_code=NULL
    WHERE sa.tenant_id=scoped_tenant AND sa.created_at<p_now-interval '14 days' AND sa.state NOT IN('sent','unknown');
  GET DIAGNOSTICS attempts_cleaned=ROW_COUNT;
  DELETE FROM storage.usage_daily WHERE tenant_id=scoped_tenant AND usage_day<(p_now::date-90);
  GET DIAGNOSTICS usage_deleted=ROW_COUNT;
  RETURN jsonb_build_object('requestsCleaned',requests_cleaned,'attemptsCleaned',attempts_cleaned,'usageDeleted',usage_deleted);
END $$;
REVOKE ALL ON FUNCTION storage.cleanup_tenant_retention(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage.cleanup_tenant_retention(timestamptz) TO changedesk_runtime;
