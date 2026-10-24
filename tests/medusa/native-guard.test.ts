import test from "node:test"
import assert from "node:assert/strict"
import { mustDenyAdminMutation, mustDenyAuthMutation } from "../../packages/medusa-plugin/src/bridge/native-policy.ts"

test("all native admin mutation families are denied to every managed demo role", () => {
  const paths = [
    "/admin/products/prod_1",
    "/admin/product-categories/pcat_1/products",
    "/admin/sales-channels/sc_1/products",
    "/admin/users/user_1",
    "/admin/rbac/roles/role_1",
    "/admin/api-keys",
    "/admin/inventory-items/iitem_1",
  ]
  for (const path of paths) assert.equal(mustDenyAdminMutation(path, true), true, path)
  assert.equal(mustDenyAdminMutation("/admin/products/prod_1", false), false)
  assert.equal(mustDenyAdminMutation("/admin/changedesk/session", true), false)
})

test("auth registration, reset and MFA mutation are denied; only login/session are exempt", () => {
  assert.equal(mustDenyAuthMutation("/auth/user/emailpass"), false)
  assert.equal(mustDenyAuthMutation("/auth/session"), false)
  assert.equal(mustDenyAuthMutation("/auth/user/emailpass/register"), true)
  assert.equal(mustDenyAuthMutation("/auth/user/emailpass/reset-password"), true)
  assert.equal(mustDenyAuthMutation("/auth/mfa/enroll"), true)
})
