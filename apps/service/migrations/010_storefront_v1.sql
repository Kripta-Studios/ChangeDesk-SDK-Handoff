-- Buyer storefront preferences and reviewed global configuration.
-- Requires storage schema/functions/roles from migrations 001/002.

CREATE FUNCTION storage.storefront_current_buyer_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.storefront_buyer_id', true), '') $$;

CREATE FUNCTION storage.storefront_current_staff_actor_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.storefront_staff_actor_id', true), '') $$;

REVOKE ALL ON FUNCTION storage.storefront_current_buyer_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION storage.storefront_current_staff_actor_id() FROM PUBLIC;

CREATE TABLE storage.storefront_globals (
  tenant_id text PRIMARY KEY REFERENCES storage.tenants(id),
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  density text NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable','compact')),
  product_layout text NOT NULL DEFAULT 'grid' CHECK (product_layout IN ('grid','list')),
  global_revision bigint NOT NULL DEFAULT 0 CHECK (global_revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE storage.storefront_buyer_preferences (
  tenant_id text NOT NULL REFERENCES storage.tenants(id),
  buyer_id text NOT NULL,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  buyer_revision bigint NOT NULL DEFAULT 0 CHECK (buyer_revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,buyer_id),
  CHECK (jsonb_typeof(overrides)='object'),
  CHECK (overrides - ARRAY['theme','density','productLayout'] = '{}'::jsonb),
  CHECK (NOT overrides ? 'theme' OR overrides->>'theme' IN ('light','dark','system')),
  CHECK (NOT overrides ? 'density' OR overrides->>'density' IN ('comfortable','compact')),
  CHECK (NOT overrides ? 'productLayout' OR overrides->>'productLayout' IN ('grid','list')),
  CHECK (NOT jsonb_path_exists(overrides, '$.* ? (@ == null)'))
);

CREATE TABLE storage.storefront_global_proposals (
  tenant_id text NOT NULL REFERENCES storage.tenants(id),
  id uuid NOT NULL,
  buyer_id text NOT NULL,
  base_global_revision bigint NOT NULL CHECK (base_global_revision >= 0),
  proposed jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  proposal_revision bigint NOT NULL DEFAULT 1 CHECK (proposal_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  decided_by text,
  PRIMARY KEY (tenant_id,id),
  CHECK (jsonb_typeof(proposed)='object'),
  CHECK (proposed - ARRAY['theme','density','productLayout'] = '{}'::jsonb),
  CHECK (proposed ?& ARRAY['theme','density','productLayout']),
  CHECK (NOT jsonb_path_exists(proposed, '$.* ? (@ == null)')),
  CHECK (proposed->>'theme' IN ('light','dark','system')),
  CHECK (proposed->>'density' IN ('comfortable','compact')),
  CHECK (proposed->>'productLayout' IN ('grid','list')),
  CHECK ((status='pending' AND decided_at IS NULL AND decided_by IS NULL) OR (status<>'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL))
);
CREATE INDEX storefront_global_proposals_admin_list ON storage.storefront_global_proposals(tenant_id,status,created_at,id);

CREATE TABLE storage.storefront_decisions (
  tenant_id text NOT NULL,
  proposal_id uuid NOT NULL,
  proposal_revision bigint NOT NULL,
  global_revision bigint NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  actor_id text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,proposal_id),
  FOREIGN KEY (tenant_id,proposal_id) REFERENCES storage.storefront_global_proposals(tenant_id,id)
);

CREATE TABLE storage.storefront_idempotency (
  tenant_id text NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('buyer','staff')),
  subject_id text NOT NULL,
  operation text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,subject_kind,subject_id,operation,idempotency_key)
);

-- Derived quota state contains no proposal content and is inaccessible directly to runtime.
-- Narrow SECURITY DEFINER functions are the sole runtime interface, avoiding an RLS-filtered COUNT.
CREATE TABLE storage.storefront_tenant_pending_counts (
  tenant_id text PRIMARY KEY REFERENCES storage.tenants(id),
  pending_count integer NOT NULL DEFAULT 0 CHECK (pending_count BETWEEN 0 AND 100)
);
CREATE TABLE storage.storefront_buyer_pending_counts (
  tenant_id text NOT NULL REFERENCES storage.tenants(id),
  buyer_id text NOT NULL,
  pending_count integer NOT NULL DEFAULT 0 CHECK (pending_count BETWEEN 0 AND 5),
  PRIMARY KEY (tenant_id,buyer_id)
);

CREATE FUNCTION storage.storefront_admit_pending(p_tenant_id text,p_buyer_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,storage AS $$
BEGIN
  IF p_tenant_id IS DISTINCT FROM storage.current_tenant_id() OR p_buyer_id IS DISTINCT FROM storage.storefront_current_buyer_id()
    OR storage.storefront_current_staff_actor_id() IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='storefront buyer context mismatch';
  END IF;
  INSERT INTO storage.storefront_tenant_pending_counts(tenant_id,pending_count) VALUES(p_tenant_id,0) ON CONFLICT DO NOTHING;
  UPDATE storage.storefront_tenant_pending_counts SET pending_count=pending_count+1 WHERE tenant_id=p_tenant_id AND pending_count<100;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='storefront_tenant_pending_quota'; END IF;
  INSERT INTO storage.storefront_buyer_pending_counts(tenant_id,buyer_id,pending_count) VALUES(p_tenant_id,p_buyer_id,0) ON CONFLICT DO NOTHING;
  UPDATE storage.storefront_buyer_pending_counts SET pending_count=pending_count+1 WHERE tenant_id=p_tenant_id AND buyer_id=p_buyer_id AND pending_count<5;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='storefront_buyer_pending_quota'; END IF;
END $$;

CREATE FUNCTION storage.storefront_release_pending(p_tenant_id text,p_buyer_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,storage AS $$
BEGIN
  IF p_tenant_id IS DISTINCT FROM storage.current_tenant_id() OR storage.storefront_current_staff_actor_id() IS NULL
    OR storage.storefront_current_buyer_id() IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='storefront staff context mismatch';
  END IF;
  UPDATE storage.storefront_tenant_pending_counts SET pending_count=GREATEST(0,pending_count-1) WHERE tenant_id=p_tenant_id;
  UPDATE storage.storefront_buyer_pending_counts SET pending_count=GREATEST(0,pending_count-1) WHERE tenant_id=p_tenant_id AND buyer_id=p_buyer_id;
END $$;

REVOKE ALL ON FUNCTION storage.storefront_admit_pending(text,text),storage.storefront_release_pending(text,text) FROM PUBLIC;

CREATE FUNCTION storage.storefront_protect_proposal() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,storage AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.id,NEW.buyer_id,NEW.base_global_revision,NEW.proposed,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.buyer_id,OLD.base_global_revision,OLD.proposed,OLD.created_at) THEN
    RAISE EXCEPTION 'storefront proposal content is immutable';
  END IF;
  IF OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected') OR NEW.proposal_revision<>OLD.proposal_revision+1 THEN
    RAISE EXCEPTION 'invalid storefront proposal transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER storefront_proposal_immutable BEFORE UPDATE ON storage.storefront_global_proposals FOR EACH ROW EXECUTE FUNCTION storage.storefront_protect_proposal();

ALTER TABLE storage.storefront_globals ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.storefront_globals FORCE ROW LEVEL SECURITY;
CREATE POLICY storefront_globals_visible ON storage.storefront_globals USING (
  tenant_id=storage.current_tenant_id() AND (storage.storefront_current_buyer_id() IS NOT NULL OR storage.storefront_current_staff_actor_id() IS NOT NULL)
) WITH CHECK (tenant_id=storage.current_tenant_id() AND storage.storefront_current_staff_actor_id() IS NOT NULL AND storage.storefront_current_buyer_id() IS NULL);

ALTER TABLE storage.storefront_buyer_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.storefront_buyer_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY storefront_buyer_preferences_private ON storage.storefront_buyer_preferences USING (
  tenant_id=storage.current_tenant_id() AND buyer_id=storage.storefront_current_buyer_id() AND storage.storefront_current_staff_actor_id() IS NULL
) WITH CHECK (tenant_id=storage.current_tenant_id() AND buyer_id=storage.storefront_current_buyer_id() AND storage.storefront_current_staff_actor_id() IS NULL);

ALTER TABLE storage.storefront_global_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.storefront_global_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY storefront_proposals_buyer ON storage.storefront_global_proposals FOR SELECT USING (
  tenant_id=storage.current_tenant_id() AND buyer_id=storage.storefront_current_buyer_id() AND storage.storefront_current_staff_actor_id() IS NULL
);
CREATE POLICY storefront_proposals_buyer_insert ON storage.storefront_global_proposals FOR INSERT WITH CHECK (
  tenant_id=storage.current_tenant_id() AND buyer_id=storage.storefront_current_buyer_id() AND storage.storefront_current_staff_actor_id() IS NULL AND status='pending'
);
CREATE POLICY storefront_proposals_staff_select ON storage.storefront_global_proposals FOR SELECT USING (
  tenant_id=storage.current_tenant_id() AND storage.storefront_current_staff_actor_id() IS NOT NULL AND storage.storefront_current_buyer_id() IS NULL
);
CREATE POLICY storefront_proposals_staff_update ON storage.storefront_global_proposals FOR UPDATE USING (
  tenant_id=storage.current_tenant_id() AND storage.storefront_current_staff_actor_id() IS NOT NULL AND storage.storefront_current_buyer_id() IS NULL
) WITH CHECK (tenant_id=storage.current_tenant_id() AND storage.storefront_current_staff_actor_id() IS NOT NULL AND storage.storefront_current_buyer_id() IS NULL);

ALTER TABLE storage.storefront_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.storefront_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY storefront_decisions_staff ON storage.storefront_decisions USING (
  tenant_id=storage.current_tenant_id() AND storage.storefront_current_staff_actor_id() IS NOT NULL AND storage.storefront_current_buyer_id() IS NULL
) WITH CHECK (tenant_id=storage.current_tenant_id() AND actor_id=storage.storefront_current_staff_actor_id() AND storage.storefront_current_buyer_id() IS NULL);

ALTER TABLE storage.storefront_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.storefront_idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY storefront_idempotency_buyer ON storage.storefront_idempotency USING (
  tenant_id=storage.current_tenant_id() AND subject_kind='buyer' AND subject_id=storage.storefront_current_buyer_id() AND storage.storefront_current_staff_actor_id() IS NULL
) WITH CHECK (tenant_id=storage.current_tenant_id() AND subject_kind='buyer' AND subject_id=storage.storefront_current_buyer_id() AND storage.storefront_current_staff_actor_id() IS NULL);
CREATE POLICY storefront_idempotency_staff ON storage.storefront_idempotency USING (
  tenant_id=storage.current_tenant_id() AND subject_kind='staff' AND subject_id=storage.storefront_current_staff_actor_id() AND storage.storefront_current_buyer_id() IS NULL
) WITH CHECK (tenant_id=storage.current_tenant_id() AND subject_kind='staff' AND subject_id=storage.storefront_current_staff_actor_id() AND storage.storefront_current_buyer_id() IS NULL);

REVOKE ALL ON storage.storefront_tenant_pending_counts,storage.storefront_buyer_pending_counts FROM PUBLIC,changedesk_runtime;
GRANT SELECT,INSERT,UPDATE ON storage.storefront_globals,storage.storefront_buyer_preferences,storage.storefront_global_proposals,
  storage.storefront_decisions,storage.storefront_idempotency TO changedesk_runtime;
GRANT EXECUTE ON FUNCTION storage.storefront_current_buyer_id(),storage.storefront_current_staff_actor_id(),
  storage.storefront_admit_pending(text,text),storage.storefront_release_pending(text,text) TO changedesk_runtime;
