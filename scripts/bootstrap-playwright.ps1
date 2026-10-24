$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$node = Join-Path $root ".tools/node-v22.23.4-win-x64/node.exe"
$cli = Join-Path $root "node_modules/@playwright/test/cli.js"
if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $cli)) {
  throw "Run scripts/bootstrap.ps1 before installing the pinned Playwright browser."
}
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $root ".tools/ms-playwright"
& $node $cli install chromium
if ($LASTEXITCODE -ne 0) { throw "Playwright Chromium install failed with exit code $LASTEXITCODE." }
Write-Output $env:PLAYWRIGHT_BROWSERS_PATH
