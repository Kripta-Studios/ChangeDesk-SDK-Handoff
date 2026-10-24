param([Parameter(Mandatory = $true)][string]$Model)
$ErrorActionPreference = "Stop"
$env:CHANGEDESK_RUN_CODEX_LIVE = "1"
$env:CHANGEDESK_CODEX_MODEL = $Model
pnpm exec vitest run tests/planner/live.codex.test.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
