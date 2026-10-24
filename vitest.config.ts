import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["{apps,packages,infra,tests}/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "**/node_modules/**", "**/dist/**"],
    passWithNoTests: false,
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    testTimeout: 10_000,
    hookTimeout: 30_000
  }
});
