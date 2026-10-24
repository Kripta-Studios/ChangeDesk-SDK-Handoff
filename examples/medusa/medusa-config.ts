import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV ?? "development", process.cwd())

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
const csv = (name: string) => required(name).split(",").map((value) => value.trim()).filter(Boolean)
const pem = (name: string) => Buffer.from(required(name), "base64").toString("utf8")

export default defineConfig({
  projectConfig: {
    databaseUrl: required("DATABASE_URL"),
    http: {
      jwtSecret: required("JWT_SECRET"),
      cookieSecret: required("COOKIE_SECRET"),
      storeCors: required("STORE_CORS"),
      adminCors: required("ADMIN_CORS"),
      authCors: required("AUTH_CORS"),
      authMethodsPerActor: { user: ["emailpass"] },
      requireActorAssociation: { emailpass: true },
    },
  },
  plugins: [
    {
      resolve: "@changedesk/medusa-plugin",
      options: {
        installationId: required("CHANGEDESK_INSTALLATION_ID"),
        tenantId: required("CHANGEDESK_TENANT_ID"),
        serviceAudience: required("CHANGEDESK_SERVICE_AUDIENCE"),
        serviceIssuer: required("CHANGEDESK_SERVICE_ISSUER"),
        bootstrapPrivateKeyPem: pem("CHANGEDESK_BOOTSTRAP_PRIVATE_KEY_PEM_BASE64"),
        servicePublicKeyPem: pem("CHANGEDESK_SERVICE_PUBLIC_KEY_PEM_BASE64"),
        allowedOrigins: csv("CHANGEDESK_ALLOWED_ORIGINS"),
        allowedCategoryIds: csv("CHANGEDESK_ALLOWED_CATEGORY_IDS"),
        allowedChannelIds: csv("CHANGEDESK_ALLOWED_CHANNEL_IDS"),
        authorityCheckUrl: required("CHANGEDESK_AUTHORITY_CHECK_URL"),
        authorityCredential: required("CHANGEDESK_AUTHORITY_CREDENTIAL"),
      },
    },
  ],
})
