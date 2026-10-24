import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createSalesChannelsWorkflow,
  createUserAccountWorkflow,
  updateUsersWorkflow,
} from "@medusajs/core-flows"
import type { IAuthModuleService } from "@medusajs/framework/types"
import { createPrivateKey, randomUUID } from "node:crypto"
import { createServer, type Server } from "node:http"
import { sha256Json, signEnvelope } from "../../../packages/medusa-plugin/src/bridge/crypto"
import { CHANGEDESK_MODULE } from "../../../packages/medusa-plugin/src/modules/changedesk"
import type ChangeDeskModuleService from "../../../packages/medusa-plugin/src/modules/changedesk/service"
import type { EffectDelegationClaims } from "../../../packages/medusa-plugin/src/bridge/types"

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let bearer = ""
    let actorId = ""
    let authorityServer: Server
    let productId = ""
    let categoryId = ""
    let channelId = ""
    let currentHostSessionId = "not-bootstrapped"
    const email = "operator.integration@example.test"
    const password = "integration-password-not-reused"

    beforeAll(async () => {
      authorityServer = createServer((request, response) => {
        const authorized = request.url === "/internal/v1/medusa/authority/check" &&
          request.headers["x-changedesk-host-credential"] === "integration-only-not-a-production-secret"
        response.writeHead(authorized ? 200 : 403, { "content-type": "application/json" })
        response.end(JSON.stringify(authorized ? { authorized: true, fence: 1 } : { authorized: false }))
      })
      await new Promise<void>((resolve) => authorityServer.listen(4199, "127.0.0.1", resolve))
      const container = getContainer()
      const auth = container.resolve(Modules.AUTH) as IAuthModuleService
      const registered = await auth.register("emailpass", {
        url: "http://127.0.0.1/auth/user/emailpass/register",
        headers: {}, query: {}, protocol: "http", body: { email, password },
      })
      if (!registered.success || !registered.authIdentity?.id) throw new Error("test auth registration failed")
      const { result: user } = await createUserAccountWorkflow(container).run({
        input: {
          authIdentityId: registered.authIdentity.id,
          userData: {
            email,
            metadata: { changedesk: { managed: true, active: true, role: "operator", policyVersion: "changedesk-lab-v1", hostSessionId: "not-bootstrapped", readableProductIds: [] } },
          },
        },
      })
      actorId = user.id
      const { result: categories } = await createProductCategoriesWorkflow(container).run({
        input: { product_categories: [{ name: "Integration campaign", handle: `integration-${randomUUID()}`, is_active: true }] },
      })
      categoryId = categories[0].id
      const { result: channels } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: `Integration ${randomUUID()}`, is_disabled: false }] },
      })
      channelId = channels[0].id
      const { result: products } = await createProductsWorkflow(container).run({
        input: { products: [{
          title: "Integration product", handle: `integration-${randomUUID()}`, status: "published",
          options: [{ title: "Default", values: ["Default"] }],
          variants: [{ title: "Default", sku: `INT-${randomUUID()}`, options: { Default: "Default" }, manage_inventory: false, prices: [{ currency_code: "eur", amount: 25 }] }],
        }] },
      })
      productId = products[0].id
      await updateUsersWorkflow(container).run({ input: { updates: [{
        id: actorId,
        metadata: { changedesk: { managed: true, active: true, role: "operator", policyVersion: "changedesk-lab-v1", hostSessionId: "not-bootstrapped", readableProductIds: [productId] } },
      }] } })
      const bridge = container.resolve(CHANGEDESK_MODULE) as ChangeDeskModuleService
      bridge.getOptions().allowedCategoryIds.push(categoryId)
      bridge.getOptions().allowedChannelIds.push(channelId)
      const login = await api.post("/auth/user/emailpass", { email, password })
      bearer = login.data.token
    })

    afterAll(async () => {
      await new Promise<void>((resolve, reject) => authorityServer.close((error) => error ? reject(error) : resolve()))
    })

    it.each([
      ["/admin/products", { title: "forbidden" }],
      ["/admin/api-keys", { title: "forbidden", type: "secret" }],
      [() => `/admin/users/${actorId}`, { first_name: "forbidden" }],
    ])("denies managed demo actor native mutation %s", async (route, body) => {
      const url = typeof route === "function" ? route() : route
      await expect(api.post(url, body, { headers: { Authorization: `Bearer ${bearer}` } })).rejects.toMatchObject({ response: { status: 403 } })
    })

    it("reauthorizes only the exact current host session and policy", async () => {
      const headers = { Authorization: "Bearer integration-only-not-a-production-secret" }
      const current = await api.post("/changedesk/bridge/v1/authorize", {
        actorId, hostSessionId: "not-bootstrapped", policyVersion: "changedesk-lab-v1",
      }, { headers })
      expect(current.data).toEqual({ active: true, roles: ["operator"], policyVersion: "changedesk-lab-v1" })
      const stale = await api.post("/changedesk/bridge/v1/authorize", {
        actorId, hostSessionId: "stale-session", policyVersion: "changedesk-lab-v1",
      }, { headers })
      expect(stale.data).toEqual({ active: false, roles: [], policyVersion: null })
      await expect(api.post("/changedesk/bridge/v1/authorize", {
        actorId, hostSessionId: "not-bootstrapped", policyVersion: "changedesk-lab-v1",
      })).rejects.toMatchObject({ response: { status: 401 } })
    })

    it("creates a bootstrap ticket only from the real cookie session and exact origin", async () => {
      const session = await api.post("/auth/session", {}, { headers: { Authorization: `Bearer ${bearer}` } })
      const cookie = session.headers["set-cookie"]?.[0]
      expect(cookie).toBeTruthy()
      const response = await api.post("/admin/changedesk/session", {}, {
        headers: { Cookie: cookie, Origin: "http://127.0.0.1:9001", "X-ChangeDesk-CSRF": "1" },
      })
      expect(response.status).toBe(200)
      expect(response.data.ticket).toEqual(expect.any(String))
      expect(Date.parse(response.data.expiresAt)).toBeGreaterThan(Date.now())
      currentHostSessionId = JSON.parse(Buffer.from(response.data.ticket.split(".")[0], "base64url").toString("utf8")).hostSessionId
    })

    it("uses the real additive category workflow and returns the durable receipt on retry", async () => {
      const args = { productId, categoryId }
      const now = Math.floor(Date.now() / 1000)
      const claims: EffectDelegationClaims = {
        v: 1, typ: "changedesk.effect", iss: "integration-service", aud: "integration-plugin",
        tenantId: "atlas", actorId, hostSessionId: currentHostSessionId, policyVersion: "changedesk-lab-v1",
        adapterVersion: "medusa-2.22.1/changedesk-1", capability: "medusa.product_categories.products.add",
        argsHash: sha256Json(args), jti: randomUUID(), iat: now, exp: now + 60,
        executionId: "exec-integration", rowId: "row-product", stepId: "category",
        planId: "plan-integration", planHash: "a".repeat(64), planVersion: 1,
        approvalId: "approval-integration", approvalExpiresAt: now + 120,
        semanticInputHash: "b".repeat(64), operationKey: "exec-integration/row-product/category", fence: 1,
        preconditions: { productStatus: "published", productUnlocked: true, relationAbsent: true },
      }
      const key = createPrivateKey(Buffer.from(process.env.CHANGEDESK_TEST_SERVICE_PRIVATE_KEY_PEM_BASE64!, "base64"))
      const invoke = (value: EffectDelegationClaims) => api.post("/changedesk/bridge/v1/commands", {
        capability: value.capability, args,
      }, { headers: { Authorization: `ChangeDesk-Delegation ${signEnvelope(value, key)}` } })
      const first = await invoke(claims)
      expect(first.data.result.status).toBe("confirmed")
      const retry = await invoke({ ...claims, jti: randomUUID(), iat: now + 1, exp: now + 61 })
      expect(retry.data.result.id).toBe(first.data.result.id)
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const observed = await query.graph({ entity: "product", fields: ["id", "categories.id"], filters: { id: productId } })
      expect(observed.data[0].categories.filter((item: { id: string }) => item.id === categoryId)).toHaveLength(1)
    })

  },
})

jest.setTimeout(60_000)
