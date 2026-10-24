CREATE TABLE storage.capability_manifests (
  tenant_id text NOT NULL,
  id text NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  adapter_version text NOT NULL,
  body jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,manifest_hash),
  FOREIGN KEY (tenant_id) REFERENCES storage.tenants(id)
);
CREATE UNIQUE INDEX capability_manifests_one_active ON storage.capability_manifests(tenant_id) WHERE active;

ALTER TABLE storage.capability_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.capability_manifests FORCE ROW LEVEL SECURITY;
CREATE POLICY capability_manifests_tenant ON storage.capability_manifests
  USING (tenant_id=storage.current_tenant_id())
  WITH CHECK (tenant_id=storage.current_tenant_id());

CREATE FUNCTION storage.protect_capability_manifest() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,storage AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.id,NEW.manifest_hash,NEW.adapter_version,NEW.body,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.id,OLD.manifest_hash,OLD.adapter_version,OLD.body,OLD.created_at) THEN
    RAISE EXCEPTION 'capability manifest content is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER capability_manifest_content_immutable BEFORE UPDATE ON storage.capability_manifests
  FOR EACH ROW EXECUTE FUNCTION storage.protect_capability_manifest();

GRANT SELECT,INSERT,UPDATE ON storage.capability_manifests TO changedesk_runtime,changedesk_worker;
