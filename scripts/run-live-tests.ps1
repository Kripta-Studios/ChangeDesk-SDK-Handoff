param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("bend", "planner")]
  [string]$Lane
)
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$node = Join-Path $root ".tools/node-v22.23.4-win-x64/node.exe"
$vitest = Join-Path $root "node_modules/vitest/vitest.mjs"
if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $vitest)) {
  throw "Run scripts/bootstrap.ps1 before the explicit live test lane."
}
$env:CHANGEDESK_VITEST_LIVE_LANE = $Lane
$testFile = if ($Lane -eq "bend") { "tests/laws/bend.live.test.ts" } else { "tests/planner/live.codex.test.ts" }
& $node $vitest run $testFile --config (Join-Path $root "vitest.config.ts")
if ($LASTEXITCODE -ne 0) { throw "$Lane live test lane failed or is blocked." }
