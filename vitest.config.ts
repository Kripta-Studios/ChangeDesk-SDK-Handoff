import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const liveLane = process.env.CHANGEDESK_VITEST_LIVE_LANE;
const requireFromService = createRequire(new URL("./apps/service/package.json", import.meta.url));

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
      },
      {
        find: /^fastify$/,
        replacement: requireFromService.resolve("fastify")
      }
    ]
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        target: "ES2022",
        useDefineForClassFields: true,
        jsx: "react-jsx",
        jsxImportSource: "react"
      }
    }
  },
  test: {
    environment: "node",
    include: process.env.STOREFRONT_POSTGRES_LIVE === "1"
      ? ["tests/storefront/postgres.live.ts"]
      : ["{apps,packages,infra,tests}/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "tests/e2e/**",
      "tests/medusa/integration/**",
      ...(liveLane === "planner" ? [] : ["tests/planner/live.codex.test.ts"]),
      ...(liveLane === "bend" ? [] : ["tests/laws/**/*.live.test.ts"]),
      "**/node_modules/**",
      "**/dist/**"
    ],
    passWithNoTests: false,
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    testTimeout: 10_000,
    hookTimeout: 30_000
  }
});
