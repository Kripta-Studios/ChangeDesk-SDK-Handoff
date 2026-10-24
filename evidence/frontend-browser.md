# Frontend browser gate

Date: 2026-10-24

Suite: `tests/e2e/changedesk.spec.ts`

Status: NOT_RUN. The suite intentionally targets a real Medusa Admin route and real server authorization; it has no fixture-only fallback and no skip. Run after the Atlas host, bridge, API, worker and seed are integrated. Required command will be the root `pnpm test:e2e` command with the Atlas viewer/operator projects configured by the environment owner.

This gate must not be reported as PASS from the component tests.
