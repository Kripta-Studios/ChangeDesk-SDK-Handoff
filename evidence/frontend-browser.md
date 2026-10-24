# Frontend browser gate

Date: 2026-10-24

Suite: `tests/e2e/changedesk.spec.ts` — five serial cases using real Atlas/Boreal HTTP, all eight fixture products, four roles, native Medusa read oracles, actor-scoped reload, installed-action zero-request observation, and opt-in Atlas publication → Boreal offer → same-artifact/local-binding installation and execution → Atlas revocation. No Medusa mocks or UI-role authority.

Status: BLOCKED. Playwright 1.64.1 with its pinned Chromium revision 1248 was invoked directly on 2026-10-24. Result: first case failed closed with `E2E_BLOCKED_PRIVATE_FIXTURE: examples/medusa/.local/credentials.atlas.json`; four serial dependants did not run. The ignored credentials and `evidence/local/seed-map.<tenant>.json` files are created only by the real Medusa seed, which has not completed. No secret value or private seed ID was printed.

Commands: set `PLAYWRIGHT_BROWSERS_PATH` to the environment-owned revision-1248 cache, then run the unchanged suite once with `CHANGEDESK_EXPECTED_PROVIDER=fake` against the explicitly fake integration deployment and once with `CHANGEDESK_EXPECTED_PROVIDER=live` against the Codex deployment: `node node_modules/@playwright/test/cli.js test tests/e2e/changedesk.spec.ts --reporter=line --workers=1`. The default is `live`; `unavailable` never satisfies either lane.

The TypeScript compilation of the E2E file passes. Once the seed and hosts exist, the same command must run without changing tests; expected fixture oracle is 5 eligible, 3 excluded and 6 new associations.

This gate must not be reported as PASS from the component tests.
