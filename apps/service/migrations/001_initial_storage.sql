CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE storage.tenants (
  id text PRIMARY KEY,
  app_kind text NOT NULL,
  backend_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE storage.host_connections (
  tenant_id text NOT NULL,
  id text NOT NULL,
  connector_version text NOT NULL,
  origin_allowlist_ref text NOT NULL,
  secret_ref text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'disabled')),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES storage.tenants (id)
);

CREATE TABLE storage.actors (
  tenant_id text NOT NULL,
  actor_id text NOT NULL,
  host_subject text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'requester', 'operator', 'admin')),
  state text NOT NULL CHECK (state IN ('enabled', 'disabled')),
  last_policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, actor_id),
  UNIQUE (tenant_id, host_subject),
  FOREIGN KEY (tenant_id) REFERENCES storage.tenants (id)
);

CREATE TABLE storage.requests (
  tenant_id text NOT NULL,
  id text NOT NULL,
  actor_id text NOT NULL,
  redacted_text text NOT NULL,
  context_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL CHECK (state IN ('received', 'searching', 'candidate_offered', 'generating', 'needs_configuration', 'needs_clarification', 'plan_ready', 'rejected', 'error')),
  budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES storage.actors (tenant_id, actor_id)
);

CREATE TABLE storage.request_messages (
  tenant_id text NOT NULL,
  request_id text NOT NULL,
  id text NOT NULL,
  actor_id text NOT NULL,
  client_request_id text NOT NULL,
  redacted_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, request_id, id),
  UNIQUE (tenant_id, actor_id, client_request_id),
  FOREIGN KEY (tenant_id, request_id) REFERENCES storage.requests (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES storage.actors (tenant_id, actor_id)
);

CREATE TABLE storage.recipe_artifacts (
  id text PRIMARY KEY,
  owner_tenant_id text,
  artifact_hash text NOT NULL UNIQUE CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  schema_version text NOT NULL,
  canonical_body jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('private', 'submitted', 'approved', 'published', 'withdrawn', 'security_revoked')),
  signature_ref text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, artifact_hash),
  FOREIGN KEY (owner_tenant_id) REFERENCES storage.tenants (id)
);

CREATE TABLE storage.artifact_grants (
  id text PRIMARY KEY,
  artifact_id text NOT NULL,
  recipient_scope text NOT NULL CHECK (recipient_scope = 'tenant'),
  recipient_tenant_id text NOT NULL,
  rights text[] NOT NULL,
  expires_at timestamptz,
  granted_by_tenant_id text,
  granted_by_actor_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (artifact_id) REFERENCES storage.recipe_artifacts (id),
  FOREIGN KEY (recipient_tenant_id) REFERENCES storage.tenants (id),
  FOREIGN KEY (granted_by_tenant_id, granted_by_actor_id) REFERENCES storage.actors (tenant_id, actor_id),
  CHECK (recipient_scope = 'tenant')
);

CREATE TABLE storage.installations (
  tenant_id text NOT NULL,
  id text NOT NULL,
  artifact_id text NOT NULL,
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  config jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'disabled', 'security_revoked')),
  installed_by text NOT NULL,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, installed_by) REFERENCES storage.actors (tenant_id, actor_id),
  FOREIGN KEY (artifact_id, artifact_hash) REFERENCES storage.recipe_artifacts (id, artifact_hash)
);

CREATE TABLE storage.plans (
  tenant_id text NOT NULL,
  id text NOT NULL,
  request_id text NOT NULL,
  installation_id text,
  actor_id text NOT NULL,
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  adapter_version text NOT NULL,
  policy_version text NOT NULL,
  capability_manifest_hash text NOT NULL CHECK (capability_manifest_hash ~ '^[a-f0-9]{64}$'),
  body jsonb NOT NULL,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[a-f0-9]{64}$'),
  plan_version integer NOT NULL CHECK (plan_version > 0),
  state text NOT NULL CHECK (state IN ('draft', 'validating', 'ready', 'rejected', 'expired', 'superseded')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, id, plan_version),
  FOREIGN KEY (tenant_id, request_id) REFERENCES storage.requests (tenant_id, id),
  FOREIGN KEY (tenant_id, installation_id) REFERENCES storage.installations (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES storage.actors (tenant_id, actor_id)
);

CREATE TABLE storage.approvals (
  tenant_id text NOT NULL,
  id text NOT NULL,
  plan_id text NOT NULL,
  plan_version integer NOT NULL,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL,
  scope text[] NOT NULL CHECK (scope <@ ARRAY['read','request','preview','approve','execute','install','share','revoke','policy.manage']::text[]),
  expires_at timestamptz NOT NULL,
  consumed_execution_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, plan_id, plan_version, actor_id),
  FOREIGN KEY (tenant_id, plan_id, plan_version) REFERENCES storage.plans (tenant_id, id, plan_version),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES storage.actors (tenant_id, actor_id)
);

CREATE TABLE storage.executions (
  tenant_id text NOT NULL,
  id text NOT NULL,
  plan_id text NOT NULL,
  plan_version integer NOT NULL,
  approval_id text NOT NULL,
  actor_id text NOT NULL,
  prior_execution_id text,
  state text NOT NULL CHECK (state IN ('queued', 'running', 'waiting_reconciliation', 'succeeded', 'partial', 'failed', 'cancelled')),
  revision bigint NOT NULL DEFAULT 0,
  cancel_requested_at timestamptz,
  deadline_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, plan_id, plan_version),
  FOREIGN KEY (tenant_id, plan_id, plan_version) REFERENCES storage.plans (tenant_id, id, plan_version),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES storage.approvals (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES storage.actors (tenant_id, actor_id),
  FOREIGN KEY (tenant_id, prior_execution_id) REFERENCES storage.executions (tenant_id, id)
);

ALTER TABLE storage.approvals
  ADD CONSTRAINT approvals_consumed_execution_fk
  FOREIGN KEY (tenant_id, consumed_execution_id) REFERENCES storage.executions (tenant_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE storage.execution_rows (
  tenant_id text NOT NULL,
  execution_id text NOT NULL,
  row_id text NOT NULL,
  resource_ref text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'running', 'succeeded', 'skipped', 'unknown', 'failed', 'needs_review')),
  precondition_fingerprint text NOT NULL,
  final_observation_ref text,
  PRIMARY KEY (tenant_id, execution_id, row_id),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES storage.executions (tenant_id, id)
);

CREATE TABLE storage.step_attempts (
  tenant_id text NOT NULL,
  execution_id text NOT NULL,
  row_id text NOT NULL,
  step_id text NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  semantic_input_hash text NOT NULL CHECK (semantic_input_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL,
  fence bigint NOT NULL CHECK (fence > 0),
  state text NOT NULL CHECK (state IN ('intent_recorded', 'sent', 'confirmed', 'no_effect', 'rejected', 'unknown')),
  receipt_ref text,
  observation_ref text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_at timestamptz,
  finished_at timestamptz,
  PRIMARY KEY (tenant_id, execution_id, row_id, step_id, attempt_no),
  UNIQUE (tenant_id, execution_id, row_id, step_id, attempt_no),
  FOREIGN KEY (tenant_id, execution_id, row_id) REFERENCES storage.execution_rows (tenant_id, execution_id, row_id)
);

CREATE TABLE storage.jobs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  backend_key text NOT NULL,
  request_id text,
  execution_id text,
  kind text NOT NULL CHECK (kind IN ('generation', 'execution', 'reconcile')),
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'completed', 'failed', 'cancelled')),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_until timestamptz,
  fence bigint NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id) REFERENCES storage.tenants (id),
  FOREIGN KEY (tenant_id, request_id) REFERENCES storage.requests (tenant_id, id),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES storage.executions (tenant_id, id),
  CHECK (
    (kind = 'generation' AND request_id IS NOT NULL AND execution_id IS NULL)
    OR (kind IN ('execution', 'reconcile') AND execution_id IS NOT NULL AND request_id IS NULL)
  )
);

CREATE TABLE storage.scheduler_tenants (
  tenant_id text PRIMARY KEY,
  next_turn timestamptz NOT NULL DEFAULT '-infinity',
  cap integer NOT NULL DEFAULT 2 CHECK (cap > 0),
  FOREIGN KEY (tenant_id) REFERENCES storage.tenants (id)
);

CREATE TABLE storage.backend_capacity (
  backend_key text PRIMARY KEY,
  cap integer NOT NULL DEFAULT 2 CHECK (cap > 0)
);

CREATE TABLE storage.capacity_leases (
  scope_type text NOT NULL CHECK (scope_type IN ('global', 'tenant', 'backend')),
  scope_id text NOT NULL,
  slot integer NOT NULL CHECK (slot > 0),
  job_id text NOT NULL,
  owner text NOT NULL,
  lease_until timestamptz NOT NULL,
  fence bigint NOT NULL CHECK (fence > 0),
  PRIMARY KEY (scope_type, scope_id, slot),
  UNIQUE (scope_type, scope_id, job_id),
  FOREIGN KEY (job_id) REFERENCES storage.jobs (id)
);

CREATE TABLE storage.idempotency_records (
  tenant_id text NOT NULL,
  actor_id text NOT NULL,
  operation text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  resource_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, actor_id, operation, key),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES storage.actors (tenant_id, actor_id)
);

CREATE TABLE storage.session_tickets (
  tenant_id text NOT NULL,
  id text NOT NULL,
  actor_id text NOT NULL,
  issuer text NOT NULL,
  jti_hash text NOT NULL CHECK (jti_hash ~ '^[a-f0-9]{64}$'),
  nonce_hash text NOT NULL,
  audience text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (issuer, jti_hash),
  UNIQUE (tenant_id, nonce_hash),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES storage.actors (tenant_id, actor_id)
);

CREATE TABLE storage.sessions (
  tenant_id text NOT NULL,
  id text NOT NULL,
  actor_id text NOT NULL,
  ticket_id text NOT NULL,
  policy_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, ticket_id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES storage.actors (tenant_id, actor_id),
  FOREIGN KEY (tenant_id, ticket_id) REFERENCES storage.session_tickets (tenant_id, id)
);

CREATE TABLE storage.audit_events (
  tenant_id text NOT NULL,
  id text NOT NULL,
  actor_id text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  action text NOT NULL,
  reason_code text,
  trace_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES storage.actors (tenant_id, actor_id)
);

CREATE TABLE storage.evidence_bundles (
  id text PRIMARY KEY,
  owner_tenant_id text,
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  environment_digest text NOT NULL,
  suite_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed', 'failed', 'blocked', 'not_run', 'not_applicable')),
  artifact_refs jsonb NOT NULL,
  privacy_scope text NOT NULL CHECK (privacy_scope IN ('private', 'generic')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (owner_tenant_id) REFERENCES storage.tenants (id),
  FOREIGN KEY (artifact_hash) REFERENCES storage.recipe_artifacts (artifact_hash)
);

CREATE TABLE storage.signing_keys (
  id text PRIMARY KEY,
  owner_tenant_id text,
  algorithm text NOT NULL CHECK (algorithm = 'Ed25519'),
  public_key bytea NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'retired', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  FOREIGN KEY (owner_tenant_id) REFERENCES storage.tenants (id)
);

CREATE TABLE storage.signing_key_secrets (
  tenant_id text NOT NULL,
  key_id text NOT NULL,
  private_key_ref text NOT NULL,
  PRIMARY KEY (tenant_id, key_id),
  FOREIGN KEY (tenant_id) REFERENCES storage.tenants (id),
  FOREIGN KEY (key_id) REFERENCES storage.signing_keys (id)
);

CREATE TABLE storage.publications (
  id text PRIMARY KEY,
  publisher_tenant_id text NOT NULL,
  publisher_actor_id text NOT NULL,
  artifact_id text NOT NULL,
  artifact_hash text NOT NULL CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  signing_key_id text NOT NULL,
  signature bytea NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('private', 'provider_catalog', 'shared_allowlist')),
  state text NOT NULL CHECK (state IN ('submitted', 'approved', 'published', 'withdrawn', 'security_revoked')),
  reviewed_metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  withdrawn_at timestamptz,
  revoked_at timestamptz,
  FOREIGN KEY (publisher_tenant_id, publisher_actor_id) REFERENCES storage.actors (tenant_id, actor_id),
  FOREIGN KEY (artifact_id, artifact_hash) REFERENCES storage.recipe_artifacts (id, artifact_hash),
  FOREIGN KEY (signing_key_id) REFERENCES storage.signing_keys (id)
);

CREATE INDEX jobs_eligible_idx ON storage.jobs (next_attempt_at, tenant_id, created_at) WHERE status = 'pending';
CREATE INDEX jobs_expired_lease_idx ON storage.jobs (lease_until) WHERE status = 'leased';
CREATE UNIQUE INDEX jobs_execution_kind_unique ON storage.jobs (tenant_id, execution_id, kind) WHERE execution_id IS NOT NULL;
CREATE UNIQUE INDEX grants_single_tenant_scope ON storage.artifact_grants (artifact_id, recipient_scope, recipient_tenant_id);
CREATE INDEX executions_actor_created_idx ON storage.executions (tenant_id, actor_id, created_at DESC);
CREATE INDEX installations_active_idx ON storage.installations (tenant_id, created_at DESC) WHERE status = 'active';
CREATE INDEX audit_tenant_time_idx ON storage.audit_events (tenant_id, occurred_at DESC);
CREATE INDEX grants_recipient_idx ON storage.artifact_grants (recipient_tenant_id, artifact_id);
