[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RunId,
  [Parameter(Mandatory = $true)][switch]$ConfirmLocalDataReset
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$envPath = Join-Path $root ".env"
if (-not $ConfirmLocalDataReset) { throw "Explicit -ConfirmLocalDataReset is required." }
if (-not (Test-Path -LiteralPath $envPath)) { throw "Missing local .env; refusing reset." }
$configuredRunId = ((Get-Content -LiteralPath $envPath -Encoding utf8 | Where-Object { $_ -like "CHANGEDESK_RUN_ID=*" }) -split "=", 2)[1]
if (-not $configuredRunId -or $RunId -ne $configuredRunId) { throw "RunId does not match this workspace." }
$composeFile = Join-Path $root "infra/compose.yaml"
$configJson = docker compose --env-file $envPath -f $composeFile config --format json
if ($LASTEXITCODE -ne 0) { throw "Docker Compose config validation failed with exit code $LASTEXITCODE." }
$projectName = $configJson | ConvertFrom-Json | Select-Object -ExpandProperty name
if ($projectName -ne "changedesk-sdk-local") { throw "Unexpected Compose project '$projectName'; refusing reset." }
$containerIds = @(docker compose --env-file $envPath -f $composeFile ps --all --quiet)
if ($LASTEXITCODE -ne 0) { throw "Could not enumerate scoped Compose containers." }
if ($containerIds.Count -eq 0) { throw "No scoped containers prove ownership; refusing volume reset." }
foreach ($containerId in $containerIds) {
  $labels = docker inspect --format '{{json .Config.Labels}}' $containerId | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect scoped container $containerId." }
  $observedProject = $labels.'com.docker.compose.project'
  $observedWorkingDir = [IO.Path]::GetFullPath($labels.'com.docker.compose.project.working_dir')
  $observedConfig = [IO.Path]::GetFullPath($labels.'com.docker.compose.project.config_files')
  if ($observedProject -ne "changedesk-sdk-local" -or $observedWorkingDir -ne $root -or $observedConfig -ne $composeFile) {
    throw "Compose labels do not identify this exact workspace; refusing reset."
  }
}
docker compose --env-file $envPath -f $composeFile down --volumes --remove-orphans
if ($LASTEXITCODE -ne 0) { throw "Docker Compose reset failed; preserving existing .env." }
Remove-Item -LiteralPath $envPath
& (Join-Path $PSScriptRoot "bootstrap.ps1")

