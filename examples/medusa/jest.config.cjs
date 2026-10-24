const { generateKeyPairSync } = require("node:crypto")
const { loadEnv } = require("@medusajs/framework/utils")

loadEnv("test", process.cwd())
const bootstrap = generateKeyPairSync("ed25519")
const service = generateKeyPairSync("ed25519")
process.env.CHANGEDESK_INSTALLATION_ID ||= "integration-plugin"
process.env.CHANGEDESK_TENANT_ID ||= "atlas"
process.env.CHANGEDESK_SERVICE_AUDIENCE ||= "integration-service"
process.env.CHANGEDESK_SERVICE_ISSUER ||= "integration-service"
process.env.CHANGEDESK_BOOTSTRAP_PRIVATE_KEY_PEM_BASE64 ||= bootstrap.privateKey.export({ type: "pkcs8", format: "pem" }).toString("base64")
process.env.CHANGEDESK_SERVICE_PUBLIC_KEY_PEM_BASE64 ||= service.publicKey.export({ type: "spki", format: "pem" }).toString("base64")
process.env.CHANGEDESK_TEST_SERVICE_PRIVATE_KEY_PEM_BASE64 ||= service.privateKey.export({ type: "pkcs8", format: "pem" }).toString("base64")
process.env.CHANGEDESK_ALLOWED_ORIGINS ||= "http://127.0.0.1:9001"
process.env.CHANGEDESK_ALLOWED_CATEGORY_IDS ||= "pcat_integration"
process.env.CHANGEDESK_ALLOWED_CHANNEL_IDS ||= "sc_integration"
process.env.CHANGEDESK_AUTHORITY_CHECK_URL ||= "http://127.0.0.1:4199/internal/v1/medusa/authority/check"
process.env.CHANGEDESK_AUTHORITY_CREDENTIAL ||= "integration-only-not-a-production-secret"
process.env.JWT_SECRET ||= "integration-jwt-secret-at-least-32-bytes"
process.env.COOKIE_SECRET ||= "integration-cookie-secret-at-least-32-bytes"
process.env.STORE_CORS ||= "http://127.0.0.1:8000"
process.env.ADMIN_CORS ||= "http://127.0.0.1:9001"
process.env.AUTH_CORS ||= "http://127.0.0.1:9001"
process.env.DATABASE_URL ||= "postgres://postgres@127.0.0.1/medusa"

module.exports = {
  rootDir: "../..",
  transform: {
    "^.+\\.[jt]s$": ["@swc/jest", {
      jsc: { parser: { syntax: "typescript", decorators: true }, target: "es2022" },
      module: { type: "es6" },
    }],
  },
  extensionsToTreatAsEsm: [".ts"],
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "json"],
  moduleDirectories: [
    "node_modules",
    "<rootDir>/examples/medusa/node_modules",
    "<rootDir>/packages/medusa-plugin/node_modules",
  ],
  roots: ["<rootDir>/tests/medusa/integration"],
  modulePathIgnorePatterns: ["[\\/]dist[\\/]", "[\\/]\.medusa[\\/]"],
  setupFiles: ["<rootDir>/examples/medusa/integration-tests/setup.cjs"],
  testRegex: "[\\/]tests[\\/]medusa[\\/]integration[\\/].*\\.spec\\.ts$",
}
