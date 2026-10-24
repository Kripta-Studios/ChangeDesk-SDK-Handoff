# Frontend browser gate

Date: 2026-10-24

Suite: `tests/e2e/changedesk.spec.ts` — five serial cases using real Atlas/Boreal HTTP, all eight fixture products, four roles, native Medusa read oracles, actor-scoped reload, installed-action zero-request observation, and opt-in Atlas publication → Boreal offer → same-artifact/local-binding installation and execution → Atlas revocation. No Medusa mocks or UI-role authority.

Status: FAIL after partial real execution; not a product PASS. With private fixtures resolved only from the environment worktree, pinned Chromium passed the host baseline: real viewer login/session, `/app/changedesk`, all eight mapped Atlas products and the native Medusa read oracle. After the trusted provisioner passed twice and the ADR014 worker restarted, the live suite again passed that baseline. The requester then opened the real panel and submitted its natural-language request, but the UI showed `No se pudo completar la operación.` and the authoritative `Proveedor real` label never appeared within the explicit 90-second generation budget. The serial suite therefore reported one pass, one failure and three dependent cases not executed. It did not reach approval, publication or Medusa mutations. Runtime subsequently identified and fixed an artifact-state authority defect (`9fa44e0`); the same suite awaits the rebuilt worker before one final rerun. No secret, ticket, token or private seed ID was printed.

Commands: set `PLAYWRIGHT_BROWSERS_PATH` to the environment-owned revision-1248 cache, then run the unchanged suite once with `CHANGEDESK_EXPECTED_PROVIDER=fake` against the explicitly fake integration deployment and once with `CHANGEDESK_EXPECTED_PROVIDER=live` against the Codex deployment: `node node_modules/@playwright/test/cli.js test tests/e2e/changedesk.spec.ts --reporter=line --workers=1`. The default is `live`; `unavailable` never satisfies either lane.

The TypeScript compilation of the E2E file passes. Once the seed and hosts exist, the same command must run without changing tests; expected fixture oracle is 5 eligible, 3 excluded and 6 new associations.

This gate must not be reported as PASS from the component tests.

Closure capture: an authenticated Atlas admin browser was left open on the real `/app/changedesk` route. A local-only screenshot was written to `evidence/local/frontend-demo.png` in the environment worktree; it is intentionally ignored because the rendered host identity and fixture identifiers are environment-local. The runtime artifact-state correction was not rebuilt and exercised before the closure deadline, so it remains unverified here.
