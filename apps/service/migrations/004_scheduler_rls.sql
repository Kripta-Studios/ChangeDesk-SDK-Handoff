-- SECURITY DEFINER scheduler functions are owned by the migration role.
-- FORCE RLS still applies to that owner. This policy is deliberately limited
-- to jobs; changedesk_worker retains EXECUTE-only access and no table grants.
CREATE POLICY jobs_scheduler_definer ON storage.jobs
  FOR ALL
  TO changedesk_migrator
  USING (true)
  WITH CHECK (true);

CREATE POLICY requests_migrator_backfill ON storage.requests FOR SELECT TO changedesk_migrator USING (true);
CREATE POLICY executions_migrator_backfill ON storage.executions FOR SELECT TO changedesk_migrator USING (true);
