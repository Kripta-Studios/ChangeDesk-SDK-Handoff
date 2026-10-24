-- A content digest is not a global ACL namespace. Identical private content in
-- two tenants has independent rows and opaque IDs; grants/publications remain
-- attached to a specific artifact row.
ALTER TABLE storage.evidence_bundles DROP CONSTRAINT evidence_bundles_artifact_hash_fkey;
ALTER TABLE storage.recipe_artifacts DROP CONSTRAINT recipe_artifacts_artifact_hash_key;
CREATE UNIQUE INDEX recipe_artifacts_owner_hash_unique ON storage.recipe_artifacts(owner_tenant_id,artifact_hash)
  WHERE owner_tenant_id IS NOT NULL;
CREATE INDEX recipe_artifacts_hash_lookup ON storage.recipe_artifacts(artifact_hash);
