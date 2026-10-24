$ErrorActionPreference = "Stop"
pnpm exec vitest run tests/planner --exclude tests/planner/live.codex.test.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
