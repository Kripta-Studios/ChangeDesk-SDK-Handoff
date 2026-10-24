$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$envPath = Join-Path $root ".env"
if (-not (Test-Path -LiteralPath $envPath)) { throw "Run scripts/bootstrap.ps1 first." }
docker compose --env-file $envPath -f (Join-Path $root "infra/compose.yaml") up -d --wait postgres
if ($LASTEXITCODE -ne 0) { throw "Docker Compose startup failed with exit code $LASTEXITCODE." }
$nodeDir = Join-Path $root ".tools/node-v22.23.4-win-x64"
$env:Path = "$nodeDir;$env:Path"
pnpm --recursive --parallel --if-present dev
if ($LASTEXITCODE -ne 0) { throw "Workspace dev command failed with exit code $LASTEXITCODE." }

