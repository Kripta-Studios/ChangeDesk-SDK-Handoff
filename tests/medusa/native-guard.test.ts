import { describe, expect, it } from "vitest"
import { mustDenyAdminMutation, mustDenyAuthMutation } from "../../packages/medusa-plugin/src/bridge/native-policy.ts"

describe("native mutation guard", () => {
it("denies all native admin mutation families to every managed demo role", () => {
  const paths = [
    "/admin/products/prod_1",
    "/admin/product-categories/pcat_1/products",
    "/admin/sales-channels/sc_1/products",
    "/admin/users/user_1",
    "/admin/rbac/roles/role_1",
    "/admin/api-keys",
    "/admin/inventory-items/iitem_1",
  ]
  for (const path of paths) expect(mustDenyAdminMutation(path, true), path).toBe(true)
  expect(mustDenyAdminMutation("/admin/products/prod_1", false)).toBe(false)
  expect(mustDenyAdminMutation("/admin/changedesk/session", true)).toBe(false)
})

it("denies auth registration, reset and MFA mutation and exempts only login/session", () => {
  expect(mustDenyAuthMutation("/auth/user/emailpass")).toBe(false)
  expect(mustDenyAuthMutation("/auth/session")).toBe(false)
  expect(mustDenyAuthMutation("/auth/user/emailpass/register")).toBe(true)
  expect(mustDenyAuthMutation("/auth/user/emailpass/reset-password")).toBe(true)
  expect(mustDenyAuthMutation("/auth/mfa/enroll")).toBe(true)
})
})
