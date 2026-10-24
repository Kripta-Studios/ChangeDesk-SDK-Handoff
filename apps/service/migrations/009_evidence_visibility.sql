CREATE POLICY evidence_generic_visible ON storage.evidence_bundles FOR SELECT USING(
  privacy_scope='generic' AND EXISTS(
    SELECT 1 FROM storage.recipe_artifacts a WHERE a.artifact_hash=evidence_bundles.artifact_hash AND a.state='published'
  )
);
