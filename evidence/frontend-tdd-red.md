# Frontend TDD — RED

Date: 2026-10-24

Behavioral RED command:

`pnpm exec vitest run --config tests/sdk/vitest.config.ts tests/sdk/client.test.ts -t "sends an Idempotency-Key" --reporter=verbose`

Observed: `1 failed | 3 skipped`; assertion at `tests/sdk/client.test.ts:34` received `undefined` instead of the exact UUID in the `Idempotency-Key` request header. This is the expected behavioral failure: the approval body contained the schema idempotency key but the transport did not bind the same value to the header.

The implementation then added the header in the shared mutation transport. Tests also cover session secrecy, finite public surface, polling cadence/cancellation, role-aware approval visibility, provider-mode disclosure, and inert hostile strings.

GREEN command:

`pnpm exec vitest run --config tests/sdk/vitest.config.ts --reporter=verbose`

Final canonical result after adding installed-action/no-model, stale-session-race, clarification, actor-scoped authorized reopen, reload selection invalidation, install continuity and English locale coverage: `3 passed` test files, `18 passed` tests, exit 0, using the single root `vitest.config.ts`. Browser/real-host coverage remains a separate blocked gate in `evidence/frontend-browser.md`.

Additional install-flow RED: the focused test `installs a prepared action without abandoning its approvable preview` failed with `Unable to find role="heading" and name "Preview del plan"`; the DOM showed the implementation had navigated to `Acciones instaladas`, making the already-reviewed plan impossible to approve. Removing that forced navigation and refreshing the library in place made the focused test pass. The actor-scope regression also proves that an old scope's private plan ID is deleted before the new actor can invoke `getPlan`.
