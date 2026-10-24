$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$node = Get-Command node -ErrorAction Stop

Push-Location -LiteralPath $repositoryRoot
try {
  & $node.Source (Join-Path $PSScriptRoot "verify-ci.mjs")
  if ($LASTEXITCODE -ne 0) {
    throw "CI verification failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}
