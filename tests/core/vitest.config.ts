import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true },
    },
  },
  resolve: {
    alias: [
      { find: "@changedesk/contracts/schemas", replacement: fileURLToPath(new URL("../../packages/contracts/src/schemas.ts", import.meta.url)) },
      { find: "@changedesk/contracts", replacement: fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url)) },
    ],
  },
  test: { include: ["tests/core/**/*.test.ts"], environment: "node" },
});
