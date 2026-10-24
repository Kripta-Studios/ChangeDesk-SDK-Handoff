import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { createUserAccountWorkflow } from "@medusajs/core-flows"
import type { IAuthModuleService } from "@medusajs/framework/types"

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let bearer = ""
    let actorId = ""
    const email = "operator.integration@example.test"
    const password = "integration-password-not-reused"

    beforeAll(async () => {
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
      const login = await api.post("/auth/user/emailpass", { email, password })
      bearer = login.data.token
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
    })

  },
})

jest.setTimeout(60_000)
