param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("api", "worker")]
  [string]$Mode
)
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$envPath = Join-Path $root ".env"
if (-not (Test-Path -LiteralPath $envPath)) { throw "Missing ignored local .env." }
foreach ($line in Get-Content -LiteralPath $envPath -Encoding utf8) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process") }
}

function Required-Environment([string]$name) {
  $value = [Environment]::GetEnvironmentVariable($name, "Process")
  if (-not $value) { throw "$name is required; run initialize-lab-secrets.ps1." }
  return $value
}
function Read-Pem([string]$name) {
  $path = [IO.Path]::GetFullPath((Required-Environment $name))
  if (-not $path.StartsWith($root + [IO.Path]::DirectorySeparatorChar) -or -not (Test-Path -LiteralPath $path)) {
    throw "$name must resolve to a workspace-local key file."
  }
  return [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
}
function Get-Sha256([string]$path) {
  $stream = [IO.File]::OpenRead($path)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() }
  finally { $sha256.Dispose(); $stream.Dispose() }
}
function Host-Configuration([string]$tenant, [int]$port) {
  $upper = $tenant.ToUpperInvariant()
  $mapPath = Join-Path $root "evidence/local/seed-map.$tenant.json"
  if (-not (Test-Path -LiteralPath $mapPath)) { throw "Missing private seed map for $tenant." }
  $map = Get-Content -Raw -LiteralPath $mapPath -Encoding utf8 | ConvertFrom-Json
  $credential = Required-Environment "${upper}_AUTHORITY_CREDENTIAL"
  return [ordered]@{
    tenantId = $tenant
    bootstrapIssuer = "$tenant-plugin"
    delegationIssuer = "changedesk-service-$tenant"
    audience = "$tenant-plugin"
    commandUrl = "http://127.0.0.1:$port/changedesk/bridge/v1/commands"
    reauthorizeUrl = "http://127.0.0.1:$port/changedesk/bridge/v1/authorize"
    bootstrapPublicKeyPem = Read-Pem "${upper}_BOOTSTRAP_PUBLIC_KEY_PATH"
    delegationPrivateKeyPem = Read-Pem "${upper}_DELEGATION_PRIVATE_KEY_PATH"
    serviceToken = $credential
    authorityCallbackCredential = $credential
    categoryIds = @($map.categories.campaign)
    channelIds = @($map.channels.campaign)
  }
}

$provider = [Environment]::GetEnvironmentVariable("CHANGEDESK_PLANNER_PROVIDER", "Process")
if (-not $provider) { $provider = "codex-cli" }
$env:CHANGEDESK_PLANNER_PROVIDER = $provider
switch ($provider) {
  "codex-cli" {
    $codex = (Get-Command codex.exe -ErrorAction Stop).Source
    $expectedCodexSha256 = "6f267830b029ee25d9339864aa867cd45de9f8fd4c5ea007d2e63c13a0c66d36"
    $actualCodexSha256 = Get-Sha256 $codex
    if ($actualCodexSha256 -ne $expectedCodexSha256) { throw "Codex executable digest does not match the reviewed 0.164.0 binary." }
    $plannerCwd = Join-Path $root ".local/planner"
    New-Item -ItemType Directory -Force -Path $plannerCwd | Out-Null
    $env:CHANGEDESK_CODEX_EXECUTABLE = $codex
    $env:CHANGEDESK_CODEX_EXECUTABLE_SHA256 = $expectedCodexSha256
    $env:CHANGEDESK_PLANNER_MODEL = "gpt-6.1-sol"
    $env:CHANGEDESK_PLANNER_ALLOWED_MODELS = "gpt-6.1-sol"
    $env:CHANGEDESK_PLANNER_ISOLATED_CWD = $plannerCwd
    $env:CHANGEDESK_PLANNER_OUTPUT_SCHEMA_PATH = Join-Path $root "apps/service/src/planner/provider-output.schema.json"
    $env:CHANGEDESK_PLANNER_MAX_OUTPUT_BYTES = "65536"
  }
  { $_ -in @("openai", "deepseek", "opencode") } {
    $keyName = @{ openai = "OPENAI_API_KEY"; deepseek = "DEEPSEEK_API_KEY"; opencode = "OPENCODE_API_KEY" }[$provider]
    [void](Required-Environment $keyName)
    [void](Required-Environment "CHANGEDESK_PLANNER_AUTHORIZED_BUDGET_USD")
    [void](Required-Environment "CHANGEDESK_PLANNER_MAX_PRICE_PER_CALL_USD")
  }
  "fake-test" {
    if ([Environment]::GetEnvironmentVariable("CHANGEDESK_ALLOW_TEST_FAKE", "Process") -ne "true") {
      throw "CHANGEDESK_ALLOW_TEST_FAKE=true is required for fake-test."
    }
  }
  default { throw "Unsupported CHANGEDESK_PLANNER_PROVIDER '$provider'." }
}

$env:CHANGEDESK_API_DATABASE_URL = Required-Environment "CHANGEDESK_RUNTIME_DATABASE_URL"
$env:CHANGEDESK_WORKER_DATABASE_URL = Required-Environment "CHANGEDESK_WORKER_DATABASE_URL"
$env:CHANGEDESK_ORIGINS = "http://127.0.0.1:8000,http://127.0.0.1:9001,http://127.0.0.1:9002"
$env:CHANGEDESK_SESSION_AUDIENCE = "changedesk-api"
$env:CHANGEDESK_SESSION_ISSUERS = "atlas-plugin,boreal-plugin"
$env:CHANGEDESK_HOSTS_JSON = @(
  Host-Configuration "atlas" 9001
  Host-Configuration "boreal" 9002
) | ConvertTo-Json -Depth 5 -Compress
$env:CHANGEDESK_PUBLICATION_KEY_ID = "local-publication-v1"
$env:CHANGEDESK_PUBLICATION_PRIVATE_KEY_PEM = Read-Pem "CHANGEDESK_PUBLICATION_PRIVATE_KEY_PATH"
$env:CHANGEDESK_PROOF_REQUIRED = "false"
$env:CHANGEDESK_PLANNER_TIMEOUT_MS = "120000"
$env:CHANGEDESK_PLANNER_MAX_INPUT_TOKENS = "120000"
$env:CHANGEDESK_HOST = "127.0.0.1"
$env:CHANGEDESK_PORT = "4100"

$node = Join-Path $root ".tools/node-v22.23.4-win-x64/node.exe"
$entrypoint = Join-Path $root "apps/service/dist/$Mode.js"
if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $entrypoint)) { throw "Build the service with the pinned Node/TypeScript toolchain first." }
& $node $entrypoint
if ($LASTEXITCODE -ne 0) { throw "Change Desk $Mode exited with code $LASTEXITCODE." }
