CREATE TABLE storage.request_candidates (
  tenant_id text NOT NULL,
  request_id text NOT NULL,
  id text NOT NULL,
  version text NOT NULL,
  artifact_hash text CHECK (artifact_hash IS NULL OR artifact_hash ~ '^[a-f0-9]{64}$'),
  recipe_key text NOT NULL,
  display_name text NOT NULL,
  required_capabilities jsonb NOT NULL,
  compatibility text NOT NULL CHECK (compatibility IN ('compatible','adaptation_required','incompatible')),
  evidence_status text NOT NULL CHECK (evidence_status IN ('passed','failed','blocked','not_run','not_applicable')),
  estimated_cost jsonb,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'offered' CHECK (state IN ('offered','selected','dismissed')),
  selected_choice text CHECK (selected_choice IS NULL OR selected_choice IN ('reuse','adapt')),
  selected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,request_id,id,version),
  FOREIGN KEY(tenant_id,request_id) REFERENCES storage.requests(tenant_id,id)
);
CREATE UNIQUE INDEX request_candidates_one_selected ON storage.request_candidates(tenant_id,request_id) WHERE state='selected';

ALTER TABLE storage.request_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.request_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY request_candidates_private ON storage.request_candidates USING(
  tenant_id=storage.current_tenant_id() AND EXISTS(
    SELECT 1 FROM storage.requests r WHERE r.tenant_id=request_candidates.tenant_id AND r.id=request_candidates.request_id AND r.actor_id=storage.current_actor_id()
  )
) WITH CHECK(
  tenant_id=storage.current_tenant_id() AND EXISTS(
    SELECT 1 FROM storage.requests r WHERE r.tenant_id=request_candidates.tenant_id AND r.id=request_candidates.request_id AND r.actor_id=storage.current_actor_id()
  )
);
GRANT SELECT,INSERT,UPDATE ON storage.request_candidates TO changedesk_runtime,changedesk_worker;
