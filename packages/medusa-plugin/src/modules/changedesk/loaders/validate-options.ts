import type { LoaderOptions } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { importPrivateKey, importPublicKey } from "../../../bridge/crypto.ts"
import type { ChangeDeskModuleOptions } from "../service.ts"

const requiredStrings: (keyof ChangeDeskModuleOptions)[] = [
  "installationId",
  "tenantId",
  "serviceAudience",
  "serviceIssuer",
  "bootstrapPrivateKeyPem",
  "servicePublicKeyPem",
  "authorityCheckUrl",
  "authorityCredential",
]

export default async function validateOptions({ options }: LoaderOptions<ChangeDeskModuleOptions>) {
  if (!options) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Change Desk plugin options are required")
  }
  for (const key of requiredStrings) {
    if (typeof options[key] !== "string" || options[key].length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Change Desk option ${key} is required`)
    }
  }
  for (const key of ["allowedOrigins", "allowedCategoryIds", "allowedChannelIds"] as const) {
    if (!Array.isArray(options[key]) || options[key].some((item) => typeof item !== "string")) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Change Desk option ${key} must be an array`)
    }
  }
  importPrivateKey(options.bootstrapPrivateKeyPem)
  importPublicKey(options.servicePublicKeyPem)
  const authorityUrl = new URL(options.authorityCheckUrl)
  if (authorityUrl.pathname !== "/internal/v1/medusa/authority/check" ||
      (authorityUrl.protocol !== "https:" && !["127.0.0.1", "localhost", "changedesk-api"].includes(authorityUrl.hostname))) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "authorityCheckUrl must be HTTPS or a fixed lab host and exact path")
  }
}
