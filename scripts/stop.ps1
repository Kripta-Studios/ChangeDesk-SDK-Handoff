$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$envPath = Join-Path $root ".env"
if (-not (Test-Path -LiteralPath $envPath)) { throw "Missing local .env; nothing was stopped." }
docker compose --env-file $envPath -f (Join-Path $root "infra/compose.yaml") stop
if ($LASTEXITCODE -ne 0) { throw "Docker Compose stop failed with exit code $LASTEXITCODE." }

