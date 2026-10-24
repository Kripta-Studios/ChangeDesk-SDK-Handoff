# Frontend browser gate

Date: 2026-10-24

Suite: `tests/e2e/changedesk.spec.ts` — five serial cases using real Atlas/Boreal HTTP, all eight fixture products, four roles, native Medusa read oracles, actor-scoped reload, installed-action zero-request observation, and opt-in Atlas publication → Boreal offer → same-artifact/local-binding installation and execution → Atlas revocation. No Medusa mocks or UI-role authority.

Status: BLOCKED after partial real execution. With the private fixtures resolved only from the environment worktree, pinned Chromium passed the host-only baseline: real viewer login/session, `/app/changedesk`, all eight mapped Atlas products and the native Medusa read oracle (`1 passed`, 7.1 s). The live suite then passed that baseline and failed before creating a Change Desk request: `/admin/changedesk/session` returned 200, but `/v1/session/exchange` returned 500 because the Change Desk database had not yet provisioned the two trusted tenants/eight actors required by the session foreign keys. Four serial dependants did not run and no Medusa effect occurred. Runtime is adding an idempotent trusted provisioner; the unchanged suite must be rerun after that state is ready. No secret, ticket, token or private seed ID was printed.

Commands: set `PLAYWRIGHT_BROWSERS_PATH` to the environment-owned revision-1248 cache, then run the unchanged suite once with `CHANGEDESK_EXPECTED_PROVIDER=fake` against the explicitly fake integration deployment and once with `CHANGEDESK_EXPECTED_PROVIDER=live` against the Codex deployment: `node node_modules/@playwright/test/cli.js test tests/e2e/changedesk.spec.ts --reporter=line --workers=1`. The default is `live`; `unavailable` never satisfies either lane.

The TypeScript compilation of the E2E file passes. Once the seed and hosts exist, the same command must run without changing tests; expected fixture oracle is 5 eligible, 3 excluded and 6 new associations.

This gate must not be reported as PASS from the component tests.
