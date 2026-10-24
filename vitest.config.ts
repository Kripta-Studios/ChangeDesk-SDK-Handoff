import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@changedesk/contracts/schemas",
        replacement: fileURLToPath(new URL("./packages/contracts/src/schemas.ts", import.meta.url))
      },
      {
        find: "@changedesk/contracts",
        replacement: fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url))
      }
    ]
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        target: "ES2022",
        useDefineForClassFields: true
      }
    }
  },
  test: {
    environment: "node",
    include: ["{apps,packages,infra,tests}/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "tests/laws/**/*.live.test.ts", "**/node_modules/**", "**/dist/**"],
    passWithNoTests: false,
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    testTimeout: 10_000,
    hookTimeout: 30_000
  }
});
