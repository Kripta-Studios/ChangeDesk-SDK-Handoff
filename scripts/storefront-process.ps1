$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$atlasMap = Join-Path $root "evidence/local/buyer-map.atlas.json"
$borealMap = Join-Path $root "evidence/local/buyer-map.boreal.json"
foreach ($path in @($atlasMap, $borealMap)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing private buyer map; run the buyer-only seed for both tenants." }
}
$atlas = Get-Content -Raw -LiteralPath $atlasMap -Encoding utf8 | ConvertFrom-Json
$boreal = Get-Content -Raw -LiteralPath $borealMap -Encoding utf8 | ConvertFrom-Json
if (-not $atlas.publishableApiKey -or -not $boreal.publishableApiKey) { throw "Buyer maps must contain publishable API keys." }
$env:VITE_MEDUSA_PUBLISHABLE_API_KEY_ATLAS = $atlas.publishableApiKey
$env:VITE_MEDUSA_PUBLISHABLE_API_KEY_BOREAL = $boreal.publishableApiKey
$node = Join-Path $root ".tools/node-v22.23.4-win-x64/node.exe"
$vite = Join-Path $root "node_modules/vite/bin/vite.js"
if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $vite)) { throw "Build/install the pinned project toolchain first." }
& $node $vite examples/storefront --host 127.0.0.1 --port 8001 --strictPort
if ($LASTEXITCODE -ne 0) { throw "Storefront exited with code $LASTEXITCODE." }
