# Frontend tarball smoke notes

The SDK and contracts were packed locally with `pnpm pack`; nothing was published. A fresh, gitignored consumer installed only the two tarballs plus exact React 18.3.1 and Vite/TypeScript build tooling. TypeScript and the production build passed. `pnpm list --depth 2` showed one React and one ReactDOM instance, with the SDK consuming them as peers.

The exercise found and corrected four packaging defects before the final clean run:

1. `@changedesk/contracts` was a normal dependency, causing a clean install to query the public registry. It is type-only at runtime and is now an explicit peer plus workspace dev dependency; the consumer supplies the contracts tarball.
2. Vite library CSS extraction emitted CSS that a normal `import "@changedesk/react"` consumer did not load. Launcher and panel styles are now developer-owned inline CSS modules: launcher styling ships with the entry and panel styling remains inside the lazy panel chunk.
3. `tsc -b` could emit JavaScript beside SDK source and `.tsbuildinfo` entered the tarball. The SDK project now uses `emitDeclarationOnly` and places build metadata outside `dist`.
4. A second clean Vite build deleted `dist/*.d.ts`, while incremental TypeScript incorrectly considered them current. The real tarball RED contained only `provider.d.ts.map` and no `index.d.ts`. The package build now runs the declaration-only project with `tsc -b . --force`; two consecutive clean builds retain all public declarations, and the installed tarball typechecks from `index.d.ts`.

The final standalone install (`frontend-tarball-smoke-clean6`) used a local `pnpm-workspace.yaml` with `allowBuilds: { esbuild: true }`, matching the environment owner's approved build policy. No blanket lifecycle-script permission was used for the accepted run. The selection-safe actor-scoped-resume SDK tarball is 39,353 bytes with SHA-256 `4D171114EA10D84DA58D548D1B4B61848FB6AC966712C09CE8D1F94344CA0A8C`.

The clean consumer browser probe observed zero panel chunk and zero API requests while idle. Opening fetched exactly one `InternalPanel` chunk and attempted the authorized installations query. Closing removed the dialog, and API request count did not grow during the following 2.5 seconds. Computed styles confirmed both launcher and lazy panel styling were present.

The waterfall was repeated with the environment-owned Playwright Chromium/Headless Shell 156.0.8078.4 revision 1248: zero panel/API requests at idle, one panel chunk after interaction, no request growth after close, and no remaining dialog. This packaging probe passes; it does not replace the real Medusa E2E gate.
