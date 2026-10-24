import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("planner configuration", () => {
  it("defaults to the reviewed local Codex provider", () => {
    expect(loadConfig(baseEnv()).planner).toMatchObject({ kind: "codex-cli", model: "gpt-6.1-sol" });
  });

  it("selects a reviewed DeepSeek API profile only with explicit spending limits", () => {
    const planner = loadConfig({ ...baseEnv(), CHANGEDESK_PLANNER_PROVIDER: "deepseek", CHANGEDESK_PLANNER_AUTHORIZED_BUDGET_USD: "1", CHANGEDESK_PLANNER_MAX_PRICE_PER_CALL_USD: "0.1" }).planner;
    expect(planner).toMatchObject({ kind: "api", config: { provider: "deepseek", endpoint: "https://api.deepseek.com/responses", model: "deepseek-flash", authorizedBudgetUsd: 1 } });
  });

  it("rejects a fake provider unless the test-only flag is explicit", () => {
    expect(() => loadConfig({ ...baseEnv(), CHANGEDESK_PLANNER_PROVIDER: "fake-test" })).toThrow(/CHANGEDESK_ALLOW_TEST_FAKE/);
  });
});

function baseEnv(): NodeJS.ProcessEnv { const host = (tenantId: string) => ({ tenantId, bootstrapIssuer: tenantId, delegationIssuer: `service-${tenantId}`, audience: "changedesk", commandUrl: "http://localhost/commands", reauthorizeUrl: "http://localhost/authorize", bootstrapPublicKeyPem: "public", delegationPrivateKeyPem: "private", serviceToken: "token", authorityCallbackCredential: "credential", categoryIds: [], channelIds: [] }); return { CHANGEDESK_API_DATABASE_URL: "postgres://api", CHANGEDESK_WORKER_DATABASE_URL: "postgres://worker", CHANGEDESK_ORIGINS: "http://localhost:9001", CHANGEDESK_SESSION_AUDIENCE: "changedesk", CHANGEDESK_SESSION_ISSUERS: "atlas", CHANGEDESK_HOSTS_JSON: JSON.stringify([host("atlas"), host("boreal")]), CHANGEDESK_PUBLICATION_KEY_ID: "key", CHANGEDESK_PUBLICATION_PRIVATE_KEY_PEM: "pem", CHANGEDESK_CODEX_EXECUTABLE: "codex", CHANGEDESK_CODEX_EXECUTABLE_SHA256: "a".repeat(64), CHANGEDESK_PLANNER_MODEL: "gpt-6.1-sol", CHANGEDESK_PLANNER_ALLOWED_MODELS: "gpt-6.1-sol", CHANGEDESK_PLANNER_ISOLATED_CWD: ".", CHANGEDESK_PLANNER_OUTPUT_SCHEMA_PATH: "schema.json" }; }
