[CmdletBinding()]
param(
  [switch]$SkipDocker
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$nodeVersion = "22.23.4"
$nodeArchive = "node-v$nodeVersion-win-x64.zip"
$toolsDir = Join-Path $root ".tools"
$nodeDir = Join-Path $toolsDir "node-v$nodeVersion-win-x64"
$nodeExe = Join-Path $nodeDir "node.exe"

function New-LocalSecret {
  $bytes = [byte[]]::new(32)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

if (-not (Test-Path -LiteralPath $nodeExe)) {
  $downloads = Join-Path $toolsDir "downloads"
  New-Item -ItemType Directory -Force -Path $downloads | Out-Null
  $archivePath = Join-Path $downloads $nodeArchive
  $sumsPath = Join-Path $downloads "SHASUMS256.txt"
  $releaseBase = "https://nodejs.org/dist/v$nodeVersion"
  Invoke-WebRequest -Uri "$releaseBase/SHASUMS256.txt" -OutFile $sumsPath
  Invoke-WebRequest -Uri "$releaseBase/$nodeArchive" -OutFile $archivePath
  $line = Get-Content -LiteralPath $sumsPath | Where-Object { $_ -match " $([regex]::Escape($nodeArchive))$" }
  if (-not $line) { throw "Official checksum for $nodeArchive was not found." }
  $expected = ($line -split "\s+")[0]
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Node archive checksum mismatch." }
  Expand-Archive -LiteralPath $archivePath -DestinationPath $toolsDir -Force
}

$observedNodeVersion = (& $nodeExe --version).TrimStart("v")
if ($observedNodeVersion -ne $nodeVersion) {
  throw "Expected Node $nodeVersion, observed $observedNodeVersion."
}

& (Join-Path $nodeDir "corepack.cmd") enable --install-directory $nodeDir
if ($LASTEXITCODE -ne 0) { throw "Corepack enable failed with exit code $LASTEXITCODE." }
$env:Path = "$nodeDir;$env:Path"
$observedPnpmVersion = (pnpm --version).Trim()
if ($LASTEXITCODE -ne 0) { throw "pnpm version check failed with exit code $LASTEXITCODE." }
if ($observedPnpmVersion -ne "11.22.0") {
  throw "Expected pnpm 11.22.0, observed $observedPnpmVersion."
}
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with exit code $LASTEXITCODE." }

$envPath = Join-Path $root ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
  $runId = "local-$([DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ'))-$((New-LocalSecret).Substring(0, 8))"
  $bootstrapPassword = New-LocalSecret
  $migratorPassword = New-LocalSecret
  $runtimePassword = New-LocalSecret
  $workerPassword = New-LocalSecret
  $atlasPassword = New-LocalSecret
  $borealPassword = New-LocalSecret
  $content = @"
CHANGEDESK_RUN_ID=$runId
POSTGRES_BOOTSTRAP_PASSWORD=$bootstrapPassword
CHANGEDESK_MIGRATOR_PASSWORD=$migratorPassword
CHANGEDESK_RUNTIME_PASSWORD=$runtimePassword
CHANGEDESK_WORKER_PASSWORD=$workerPassword
ATLAS_DB_PASSWORD=$atlasPassword
BOREAL_DB_PASSWORD=$borealPassword
CHANGEDESK_POSTGRES_PORT=5432
CHANGEDESK_API_PORT=4100
ATLAS_PORT=9001
BOREAL_PORT=9002
CHANGEDESK_MIGRATOR_DATABASE_URL=postgresql://changedesk_migrator:$migratorPassword@127.0.0.1:5432/changedesk
CHANGEDESK_RUNTIME_DATABASE_URL=postgresql://changedesk_runtime:$runtimePassword@127.0.0.1:5432/changedesk
CHANGEDESK_WORKER_DATABASE_URL=postgresql://changedesk_worker:$workerPassword@127.0.0.1:5432/changedesk
ATLAS_DATABASE_URL=postgresql://atlas_owner:$atlasPassword@127.0.0.1:5432/atlas
BOREAL_DATABASE_URL=postgresql://boreal_owner:$borealPassword@127.0.0.1:5432/boreal
"@
  [IO.File]::WriteAllText($envPath, $content, [Text.UTF8Encoding]::new($false))
}

if (-not $SkipDocker) {
  docker compose --env-file $envPath -f (Join-Path $root "infra/compose.yaml") up -d --wait postgres
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose startup failed with exit code $LASTEXITCODE." }
}

Write-Output "Change Desk environment ready with Node $nodeVersion and pnpm 11.22.0."
Write-Output "Local secrets remain in ignored file: $envPath"

