param([switch]$ConfirmScopedCleanup)

$ErrorActionPreference = "Stop"
if (-not $ConfirmScopedCleanup) { throw "Pass -ConfirmScopedCleanup to permit cleanup of this run's exact temporary database and role." }

$container = "changedesk-sdk-local-postgres-1"
$expectedProject = "changedesk-sdk-local"
$project = (& docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' $container).Trim()
if ($project -ne $expectedProject) { throw "Unexpected Compose project for $container" }

$runId = ([guid]::NewGuid().ToString("N").Substring(0, 10)).ToLowerInvariant()
$database = "changedesk_sf_$runId"
$runtimeRole = "changedesk_sf_${runId}_rt"
$password = [guid]::NewGuid().ToString("N")
$roleCreated = $false
$databaseCreated = $false
if ($database -notmatch '^changedesk_sf_[a-f0-9]{10}$' -or $runtimeRole -notmatch '^changedesk_sf_[a-f0-9]{10}_rt$') { throw "Unsafe temporary identifier" }

function Invoke-BootstrapSql([string]$DatabaseName, [string]$Sql) {
  $Sql | & docker exec -i $container psql -X -v ON_ERROR_STOP=1 -U changedesk_bootstrap -d $DatabaseName
  if ($LASTEXITCODE -ne 0) { throw "psql failed for scoped database" }
}

try {
  Invoke-BootstrapSql "postgres" "CREATE ROLE `"$runtimeRole`" LOGIN PASSWORD '$password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;"
  $roleCreated = $true
  Invoke-BootstrapSql "postgres" "CREATE DATABASE `"$database`" OWNER changedesk_bootstrap;"
  $databaseCreated = $true
  Invoke-BootstrapSql $database @"
CREATE SCHEMA storage;
CREATE TABLE storage.tenants(id text PRIMARY KEY);
INSERT INTO storage.tenants(id) VALUES('atlas'),('boreal');
CREATE FUNCTION storage.current_tenant_id() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS `$`$ SELECT nullif(current_setting('app.tenant_id', true), '') `$`$;
CREATE FUNCTION storage.current_actor_id() RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS `$`$ SELECT nullif(current_setting('app.actor_id', true), '') `$`$;
REVOKE ALL ON FUNCTION storage.current_tenant_id(),storage.current_actor_id() FROM PUBLIC;
"@
  Get-Content -LiteralPath (Join-Path $PSScriptRoot "..\..\apps\service\migrations\010_storefront_v1.sql") -Raw | & docker exec -i $container psql -X -v ON_ERROR_STOP=1 -U changedesk_bootstrap -d $database
  if ($LASTEXITCODE -ne 0) { throw "storefront migration failed" }
  Invoke-BootstrapSql $database @"
GRANT CONNECT ON DATABASE `"$database`" TO `"$runtimeRole`";
GRANT USAGE ON SCHEMA storage TO `"$runtimeRole`";
GRANT SELECT,INSERT,UPDATE ON storage.storefront_globals,storage.storefront_buyer_preferences,storage.storefront_global_proposals,storage.storefront_decisions,storage.storefront_idempotency TO `"$runtimeRole`";
GRANT EXECUTE ON FUNCTION storage.current_tenant_id(),storage.current_actor_id(),storage.storefront_current_buyer_id(),storage.storefront_current_staff_actor_id(),storage.storefront_admit_pending(text,text),storage.storefront_release_pending(text,text) TO `"$runtimeRole`";
"@

  if (-not (Test-Path (Join-Path $PSScriptRoot "..\..\node_modules\pg"))) {
    $pgTarget = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\environment\apps\service\node_modules\pg")).Path
    New-Item -ItemType Junction -Path (Join-Path $PSScriptRoot "..\..\node_modules\pg") -Target $pgTarget | Out-Null
  }
  $node = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\environment\.tools\node-v22.23.4-win-x64\node.exe")).Path
  $vitest = (Get-ChildItem (Join-Path $PSScriptRoot "..\..\..\environment\node_modules\.pnpm") -Directory -Filter 'vitest@4.0.16_@types+node@22.19.0_jsdom@30.1.3' | Select-Object -First 1 | ForEach-Object { Join-Path $_.FullName 'node_modules\vitest\vitest.mjs' })
  if (-not $vitest -or -not (Test-Path $vitest)) { throw "Pinned Vitest 4.0.16 installation not found" }
  $env:STOREFRONT_DATABASE_URL = "postgresql://${runtimeRole}:${password}@127.0.0.1:5432/${database}"
  $env:STOREFRONT_POSTGRES_LIVE = "1"
  & $node $vitest run --config vitest.config.ts --reporter=verbose --pool=threads --maxWorkers=1
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL live gate failed" }
} finally {
  Remove-Item Env:STOREFRONT_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:STOREFRONT_POSTGRES_LIVE -ErrorAction SilentlyContinue
  if ($ConfirmScopedCleanup -and $database -match '^changedesk_sf_[a-f0-9]{10}$' -and $runtimeRole -match '^changedesk_sf_[a-f0-9]{10}_rt$') {
    if ($databaseCreated) { Invoke-BootstrapSql "postgres" "DROP DATABASE IF EXISTS `"$database`" WITH (FORCE);" }
    if ($roleCreated) { Invoke-BootstrapSql "postgres" "DROP ROLE IF EXISTS `"$runtimeRole`";" }
  }
}
