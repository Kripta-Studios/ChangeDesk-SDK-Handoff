# Frontend tarball smoke notes

The SDK and contracts were packed locally with `pnpm pack`; nothing was published. A fresh, gitignored consumer installed only the two tarballs plus exact React 18.3.1 and Vite/TypeScript build tooling. TypeScript and the production build passed. `pnpm list --depth 2` showed one React and one ReactDOM instance, with the SDK consuming them as peers.

The exercise found and corrected three packaging defects before the final clean run:

1. `@changedesk/contracts` was a normal dependency, causing a clean install to query the public registry. It is type-only at runtime and is now an explicit peer plus workspace dev dependency; the consumer supplies the contracts tarball.
2. Vite library CSS extraction emitted CSS that a normal `import "@changedesk/react"` consumer did not load. Launcher and panel styles are now developer-owned inline CSS modules: launcher styling ships with the entry and panel styling remains inside the lazy panel chunk.
3. `tsc -b` could emit JavaScript beside SDK source and `.tsbuildinfo` entered the tarball. The SDK project now uses `emitDeclarationOnly` and places build metadata outside `dist`.

The final standalone install used a local `pnpm-workspace.yaml` with `allowBuilds: { esbuild: true }`, matching the environment owner's approved build policy. No blanket lifecycle-script permission was used for the accepted run.

The clean consumer browser probe observed zero panel chunk and zero API requests while idle. Opening fetched exactly one `InternalPanel` chunk and attempted the authorized installations query. Closing removed the dialog, and API request count did not grow during the following 2.5 seconds. Computed styles confirmed both launcher and lazy panel styling were present.

The Playwright-managed Chromium binary is still absent. System Chrome was driven through Playwright for this packaging diagnostic; this does not satisfy the pinned release browser matrix or real Medusa E2E gate.
