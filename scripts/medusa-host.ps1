param(
  [Parameter(Mandatory = $true)][ValidateSet("atlas", "boreal")][string]$Tenant,
  [Parameter(Mandatory = $true)][ValidateSet("build", "migrate", "seed", "start", "develop")][string]$Command
)
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$hostRoot = Join-Path $root "examples/medusa"
$envPath = Join-Path $root ".env"
if (-not (Test-Path -LiteralPath $envPath)) { throw "Run scripts/bootstrap.ps1 first." }
foreach ($line in Get-Content -LiteralPath $envPath -Encoding utf8) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process") }
}

function Ensure-Junction([string]$Path, [string]$Target) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    New-Item -ItemType Junction -Path $Path -Target $Target | Out-Null
  }
}
$modules = Join-Path $hostRoot "node_modules"
New-Item -ItemType Directory -Force -Path (Join-Path $modules "@medusajs") | Out-Null
$medusaLink = Get-Item -LiteralPath (Join-Path $root "packages/medusa-plugin/node_modules/@medusajs/medusa") -Force
$medusaTarget = [IO.Path]::GetFullPath((Join-Path (Split-Path $medusaLink.FullName -Parent) ([string]$medusaLink.Target)))
$medusaScope = Split-Path $medusaTarget -Parent
foreach ($package in Get-ChildItem -LiteralPath $medusaScope -Directory) {
  Ensure-Junction (Join-Path $modules "@medusajs/$($package.Name)") $package.FullName
}
foreach ($packageName in @("admin-sdk", "admin-shared", "cli", "test-utils")) {
  Ensure-Junction (Join-Path $modules "@medusajs/$packageName") (Join-Path $root "packages/medusa-plugin/node_modules/@medusajs/$packageName")
}
Ensure-Junction (Join-Path $modules "@medusajs/dashboard") (Join-Path $root "node_modules/.pnpm/node_modules/@medusajs/dashboard")
Ensure-Junction (Join-Path $modules "@changedesk/medusa-plugin") (Join-Path $root "packages/medusa-plugin")
Ensure-Junction (Join-Path $modules "@swc/core") (Join-Path $root "packages/medusa-plugin/node_modules/@swc/core")
Ensure-Junction (Join-Path $modules "@swc/jest") (Join-Path $root "node_modules/@swc/jest")
Ensure-Junction (Join-Path $modules "jest") (Join-Path $root "node_modules/jest")
Ensure-Junction (Join-Path $modules "typescript") (Join-Path $root "packages/medusa-plugin/node_modules/typescript")
Ensure-Junction (Join-Path $modules "ts-node") (Join-Path $root "packages/medusa-plugin/node_modules/ts-node")

$upper = $Tenant.ToUpperInvariant()
$port = if ($Tenant -eq "atlas") { 9001 } else { 9002 }
$databaseUrl = [Environment]::GetEnvironmentVariable("${upper}_DATABASE_URL", "Process")
$jwtSecret = [Environment]::GetEnvironmentVariable("${upper}_JWT_SECRET", "Process")
$cookieSecret = [Environment]::GetEnvironmentVariable("${upper}_COOKIE_SECRET", "Process")
$credential = [Environment]::GetEnvironmentVariable("${upper}_AUTHORITY_CREDENTIAL", "Process")
$bootstrapPrivate = [Environment]::GetEnvironmentVariable("${upper}_BOOTSTRAP_PRIVATE_KEY_PATH", "Process")
$delegationPublic = [Environment]::GetEnvironmentVariable("${upper}_DELEGATION_PUBLIC_KEY_PATH", "Process")
foreach ($value in @($databaseUrl, $jwtSecret, $cookieSecret, $credential, $bootstrapPrivate, $delegationPublic)) {
  if (-not $value) { throw "Missing generated $Tenant host configuration; run scripts/initialize-lab-secrets.ps1." }
}

$categoryId = "bootstrap-placeholder"
$channelId = "bootstrap-placeholder"
$seedMap = Join-Path $root "evidence/medusa-seed-map.$Tenant.json"
if (Test-Path -LiteralPath $seedMap) {
  $map = Get-Content -Raw -LiteralPath $seedMap | ConvertFrom-Json
  $categoryId = $map.categories.campaign
  $channelId = $map.channels.campaign
}
$env:NODE_ENV = "development"
$env:PORT = [string]$port
$env:DATABASE_URL = $databaseUrl
$env:JWT_SECRET = $jwtSecret
$env:COOKIE_SECRET = $cookieSecret
$env:STORE_CORS = "http://127.0.0.1:8000"
$env:ADMIN_CORS = "http://127.0.0.1:$port"
$env:AUTH_CORS = "http://127.0.0.1:$port"
$env:CHANGEDESK_INSTALLATION_ID = "$Tenant-plugin"
$env:CHANGEDESK_TENANT_ID = $Tenant
$env:CHANGEDESK_SERVICE_AUDIENCE = "changedesk-api"
$env:CHANGEDESK_SERVICE_ISSUER = "changedesk-service-$Tenant"
$env:CHANGEDESK_BOOTSTRAP_PRIVATE_KEY_PEM_BASE64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($bootstrapPrivate))
$env:CHANGEDESK_SERVICE_PUBLIC_KEY_PEM_BASE64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($delegationPublic))
$env:CHANGEDESK_ALLOWED_ORIGINS = "http://127.0.0.1:$port"
$env:CHANGEDESK_ALLOWED_CATEGORY_IDS = $categoryId
$env:CHANGEDESK_ALLOWED_CHANNEL_IDS = $channelId
$env:CHANGEDESK_AUTHORITY_CHECK_URL = "http://127.0.0.1:4100/internal/v1/medusa/authority/check"
$env:CHANGEDESK_AUTHORITY_CREDENTIAL = $credential
$env:MEDUSA_DISABLE_TELEMETRY = "true"
$env:MEDUSA_FF_ANALYTICS = "false"

$node = Join-Path $root ".tools/node-v22.23.4-win-x64/node.exe"
$cli = Join-Path $root "packages/medusa-plugin/node_modules/@medusajs/cli/cli.js"
$cliArguments = [string[]]@(switch ($Command) {
  "build" { "build" }
  "migrate" { "db:migrate" }
  "seed" { "exec"; "./src/scripts/seed.ts" }
  "start" { "start" }
  "develop" { "develop" }
})
Push-Location $hostRoot
try {
  & $node $cli @cliArguments
  if ($LASTEXITCODE -ne 0) { throw "Medusa $Command failed for $Tenant with exit code $LASTEXITCODE." }
} finally { Pop-Location }
