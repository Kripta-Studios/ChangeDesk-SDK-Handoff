# Frontend TDD — RED

Date: 2026-10-24

Behavioral RED command:

`pnpm exec vitest run --config tests/sdk/vitest.config.ts tests/sdk/client.test.ts -t "sends an Idempotency-Key" --reporter=verbose`

Observed: `1 failed | 3 skipped`; assertion at `tests/sdk/client.test.ts:34` received `undefined` instead of the exact UUID in the `Idempotency-Key` request header. This is the expected behavioral failure: the approval body contained the schema idempotency key but the transport did not bind the same value to the header.

The implementation then added the header in the shared mutation transport. Tests also cover session secrecy, finite public surface, polling cadence/cancellation, role-aware approval visibility, provider-mode disclosure, and inert hostile strings.

GREEN command:

`pnpm exec vitest run --config tests/sdk/vitest.config.ts --reporter=verbose`

Final canonical result after adding installed-action/no-model, stale-session-race, clarification, authorized reopen and English locale coverage: `3 passed` test files, `15 passed` tests, exit 0, using the single root `vitest.config.ts`. Browser/real-host coverage remains a separate NOT_RUN gate in `evidence/frontend-browser.md`.
