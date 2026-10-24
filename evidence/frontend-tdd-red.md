# Frontend TDD — RED

Date: 2026-10-24

Behavioral RED command:

`pnpm exec vitest run --config tests/sdk/vitest.config.ts tests/sdk/client.test.ts -t "sends an Idempotency-Key" --reporter=verbose`

Observed: `1 failed | 3 skipped`; assertion at `tests/sdk/client.test.ts:34` received `undefined` instead of the exact UUID in the `Idempotency-Key` request header. This is the expected behavioral failure: the approval body contained the schema idempotency key but the transport did not bind the same value to the header.

The implementation then added the header in the shared mutation transport. Tests also cover session secrecy, finite public surface, polling cadence/cancellation, role-aware approval visibility, provider-mode disclosure, and inert hostile strings.

GREEN command:

`pnpm exec vitest run --config tests/sdk/vitest.config.ts --reporter=verbose`

Final observed result after adding unknown/reconciliation and session-unmount coverage: `3 passed` test files, `10 passed` tests, exit 0. Browser/real-host coverage remains a separate NOT_RUN gate in `evidence/frontend-browser.md`.
