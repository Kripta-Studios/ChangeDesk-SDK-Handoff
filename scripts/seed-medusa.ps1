param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("atlas", "boreal")]
  [string]$Tenant
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$hostPath = (Resolve-Path -LiteralPath (Join-Path $repoRoot "examples\medusa")).Path
if ($hostPath -notlike "$repoRoot*") { throw "Resolved host path escaped the repository" }
if ($env:CHANGEDESK_TENANT_ID -ne $Tenant) { throw "CHANGEDESK_TENANT_ID must equal $Tenant" }
& pnpm --dir $hostPath seed
if ($LASTEXITCODE -ne 0) { throw "Medusa seed failed with exit code $LASTEXITCODE" }
