param([switch]$ConfirmScopedCleanup)

$ErrorActionPreference = "Stop"
if (-not $ConfirmScopedCleanup) { throw "Pass -ConfirmScopedCleanup to permit cleanup of this run's exact temporary database and role." }

$container = "changedesk-sdk-local-postgres-1"
$expectedProject = "changedesk-sdk-local"
$labelsJson = (& docker inspect --format '{{json .Config.Labels}}' $container)
if ($LASTEXITCODE -ne 0 -or -not $labelsJson) { throw "Unable to inspect scoped PostgreSQL container" }
$labels = $labelsJson | ConvertFrom-Json
$project = [string]$labels.'com.docker.compose.project'
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
  $migrationRoot = Join-Path $PSScriptRoot "..\..\apps\service\migrations"
  $migrationFiles = Get-ChildItem -LiteralPath $migrationRoot -Filter '*.sql' | Where-Object { $_.Name -match '^(00[1-9]|01[0-3]|1000)_' } | Sort-Object { [int]($_.Name -replace '^([0-9]+).*','$1') }
  $expectedMigrations = '001_initial_storage.sql,002_rls_and_privileges.sql,003_scheduler.sql,004_scheduler_rls.sql,005_worker_fencing.sql,006_capability_manifests.sql,007_approval_host_session.sql,008_request_candidates.sql,009_evidence_visibility.sql,010_admission_and_generation_budget.sql,011_tenant_artifact_identity.sql,012_retention_and_tombstones.sql,013_scheduler_class_caps.sql,1000_storefront_v1.sql'
  if (($migrationFiles.Name -join ',') -ne $expectedMigrations) { throw "Unexpected migration stack" }
  foreach ($migration in $migrationFiles) {
    Get-Content -LiteralPath $migration.FullName -Raw | & docker exec -i $container psql -X -v ON_ERROR_STOP=1 -U changedesk_bootstrap -d $database
    if ($LASTEXITCODE -ne 0) { throw "Migration stack failed at $($migration.Name)" }
  }
  Invoke-BootstrapSql $database "INSERT INTO storage.tenants(id,app_kind,backend_key,status,policy_version) VALUES('atlas','medusa','atlas','active','p1'),('boreal','medusa','boreal','active','p1');"
  Invoke-BootstrapSql $database @"
GRANT CONNECT ON DATABASE `"$database`" TO `"$runtimeRole`";
GRANT USAGE ON SCHEMA storage TO `"$runtimeRole`";
GRANT SELECT,INSERT,UPDATE ON storage.storefront_globals,storage.storefront_buyer_preferences,storage.storefront_global_proposals,storage.storefront_decisions,storage.storefront_idempotency,storage.storefront_session_tickets TO `"$runtimeRole`";
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
