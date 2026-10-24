CREATE POLICY artifacts_catalog_definer ON storage.recipe_artifacts TO changedesk_migrator USING(true);
CREATE POLICY grants_catalog_definer ON storage.artifact_grants TO changedesk_migrator USING(true);
CREATE POLICY publications_catalog_definer ON storage.publications TO changedesk_migrator USING(true);
CREATE POLICY actors_catalog_definer ON storage.actors FOR SELECT TO changedesk_migrator USING(true);

CREATE INDEX recipe_artifacts_owner_catalog_idx ON storage.recipe_artifacts(owner_tenant_id,created_at DESC,id)
  WHERE state IN('private','published');
CREATE INDEX recipe_artifacts_compatibility_idx ON storage.recipe_artifacts(
  (canonical_body#>>'{compatibility,adapter}'),(canonical_body#>>'{compatibility,capabilityContract}'),created_at DESC,id)
  WHERE state IN('private','published');
CREATE INDEX grants_recipient_read_idx ON storage.artifact_grants(recipient_tenant_id,artifact_id)
  WHERE 'read'=ANY(rights);
CREATE INDEX publications_artifact_published_idx ON storage.publications(artifact_id) WHERE state='published';

CREATE FUNCTION storage.list_discoverable_catalog(p_recipe_key text,p_adapter text,p_capability_contract text,p_limit integer)
RETURNS TABLE(id text,owner_tenant_id text,artifact_hash text,schema_version text,canonical_body jsonb,state text,
  publication_id text,publisher_tenant_id text,signing_key_id text,signature bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,storage AS $$
DECLARE scoped_tenant text:=nullif(current_setting('app.tenant_id',true),'');scoped_actor text:=nullif(current_setting('app.actor_id',true),'');
BEGIN
  IF scoped_tenant IS NULL OR scoped_actor IS NULL OR p_adapter='' OR p_capability_contract='' OR p_limit<1 OR p_limit>20 THEN
    RAISE EXCEPTION 'invalid catalog query';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.tenants t JOIN storage.actors ac ON ac.tenant_id=t.id
    WHERE t.id=scoped_tenant AND t.status='active' AND ac.actor_id=scoped_actor AND ac.state='enabled')
    OR NOT storage.tenant_not_tombstoned(scoped_tenant) THEN RETURN; END IF;
  RETURN QUERY
  WITH authorized AS MATERIALIZED(
    SELECT a.id,true owned FROM storage.recipe_artifacts a WHERE a.owner_tenant_id=scoped_tenant AND a.state IN('private','published')
    UNION ALL
    SELECT g.artifact_id,false FROM storage.artifact_grants g
      WHERE g.recipient_scope='tenant' AND g.recipient_tenant_id=scoped_tenant AND 'read'=ANY(g.rights)
        AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())
        AND NOT EXISTS(SELECT 1 FROM storage.recipe_artifacts own WHERE own.id=g.artifact_id AND own.owner_tenant_id=scoped_tenant)
  ), eligible AS MATERIALIZED(
    SELECT a.id,a.owner_tenant_id,a.artifact_hash,a.schema_version,a.canonical_body,a.state,a.created_at,authorized.owned
    FROM authorized JOIN storage.recipe_artifacts a ON a.id=authorized.id
    WHERE a.state IN('private','published') AND (p_recipe_key IS NULL OR a.canonical_body->>'recipeKey'=p_recipe_key)
      AND a.canonical_body#>>'{compatibility,adapter}'=p_adapter
      AND a.canonical_body#>>'{compatibility,capabilityContract}'=p_capability_contract
    ORDER BY authorized.owned DESC,a.created_at DESC,a.id LIMIT p_limit
  )
  SELECT e.id,e.owner_tenant_id,e.artifact_hash,e.schema_version,e.canonical_body,e.state,
    p.id,p.publisher_tenant_id,p.signing_key_id,p.signature FROM eligible e
  LEFT JOIN storage.publications p ON p.artifact_id=e.id AND p.artifact_hash=e.artifact_hash AND p.state='published'
  ORDER BY e.owned DESC,e.created_at DESC,e.id;
END $$;
REVOKE ALL ON FUNCTION storage.list_discoverable_catalog(text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage.list_discoverable_catalog(text,text,text,integer) TO changedesk_runtime,changedesk_worker;
