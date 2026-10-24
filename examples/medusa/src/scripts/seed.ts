import type { ExecArgs, IAuthModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createProductTagsWorkflow,
  createSalesChannelsWorkflow,
  createCustomerAccountWorkflow,
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  createUserAccountWorkflow,
} from "@medusajs/core-flows"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { randomBytes, randomUUID } from "node:crypto"
import path from "node:path"

type Fixture = {
  namespace: string
  tenants: Array<{
    key: string
    categoryHandle: string
    channelName: string
    currency: string
    basePrice: number
    actors: Array<{ key: string; role: string; email: string }>
  }>
  products: Array<{
    key: string
    status: "draft" | "proposed" | "published" | "rejected"
    locked: boolean
    campaignCategory: boolean
    campaignChannel: boolean
    description: string
  }>
}

const password = () => randomBytes(24).toString("base64url")

async function provisionBuyers(container: ExecArgs["container"], tenantKey: "atlas" | "boreal", createdBy: string, channelIds: string[]) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const buyers = [1, 2].map((number) => ({
    key: `${tenantKey}.buyer${number}`,
    email: `changedesk-buyer-${number}-${tenantKey}@local.invalid`,
    firstName: `Buyer ${number}`,
  }))
  const localDir = path.resolve(process.cwd(), ".local")
  const evidenceDir = path.resolve(process.cwd(), "../../evidence/local")
  await mkdir(localDir, { recursive: true })
  await mkdir(evidenceDir, { recursive: true })
  const credentialsPath = path.join(localDir, `buyer-credentials.${tenantKey}.json`)
  const mapPath = path.join(evidenceDir, `buyer-map.${tenantKey}.json`)
  let credentials: Record<string, { email: string; password: string }> = {}
  try { credentials = JSON.parse(await readFile(credentialsPath, "utf8")) as typeof credentials }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    await writeFile(credentialsPath, "{}", { mode: 0o600, flag: "wx" })
  }
  const existing = await query.graph({ entity: "customer", fields: ["id", "email"], filters: { email: buyers.map(({ email }) => email) } })
  const ids: Record<string, string> = {}
  const auth = container.resolve(Modules.AUTH) as IAuthModuleService
  for (const buyer of buyers) {
    const customer = existing.data.find((item: { email?: string }) => item.email === buyer.email) as { id?: string } | undefined
    if (customer?.id) {
      if (!credentials[buyer.key]) throw new Error(`Buyer ${buyer.key} exists but its private fixture credential is unavailable; refusing to overwrite`)
      ids[buyer.key] = customer.id
      continue
    }
    const generatedPassword = password()
    const registered = await auth.register("emailpass", {
      url: "http://127.0.0.1/auth/customer/emailpass/register",
      headers: {}, query: {}, protocol: "http",
      body: { email: buyer.email, password: generatedPassword },
    })
    if (!registered.success || !registered.authIdentity?.id) throw new Error(`Could not register ${buyer.key}`)
    const { result: created } = await createCustomerAccountWorkflow(container).run({
      input: {
        authIdentityId: registered.authIdentity.id,
        customerData: { email: buyer.email, first_name: buyer.firstName, last_name: tenantKey, metadata: { changedesk_fixture: true, changedesk_key: buyer.key } },
      },
    })
    ids[buyer.key] = created.id
    credentials[buyer.key] = { email: buyer.email, password: generatedPassword }
    await writeFile(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 })
  }
  const keyTitle = `changedesk-lab-${tenantKey}-storefront`
  const keys = await query.graph({ entity: "api_key", fields: ["id", "token", "sales_channels.id"], filters: { title: keyTitle, type: "publishable" } })
  let apiKey = keys.data[0] as { id: string; token: string; sales_channels?: Array<{ id: string }> } | undefined
  if (!apiKey) {
    const { result } = await createApiKeysWorkflow(container).run({ input: { api_keys: [{ title: keyTitle, type: "publishable", created_by: createdBy }] } })
    apiKey = result[0]
  }
  if (!apiKey?.id || !apiKey.token) throw new Error("Could not provision the storefront publishable API key")
  const linked = new Set(apiKey.sales_channels?.map(({ id }) => id) ?? [])
  const add = channelIds.filter((id) => !linked.has(id))
  if (add.length) await linkSalesChannelsToApiKeyWorkflow(container).run({ input: { id: apiKey.id, add, remove: [] } })
  await writeFile(mapPath, JSON.stringify({ tenant: tenantKey, buyers: ids, publishableApiKey: apiKey.token }, null, 2), { mode: 0o600 })
  return { buyers: ids, publishableApiKey: apiKey.token }
}

export default async function seed({ container }: ExecArgs) {
  const tenantKey = process.env.CHANGEDESK_TENANT_ID
  if (tenantKey !== "atlas" && tenantKey !== "boreal") throw new Error("CHANGEDESK_TENANT_ID must be atlas or boreal")
  const fixturePath = path.resolve(process.cwd(), "../../fixtures/medusa-scenarios.json")
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture
  const tenant = fixture.tenants.find((item) => item.key === tenantKey)
  if (!tenant) throw new Error("Tenant fixture not found")
  if (process.env.CHANGEDESK_SEED_BUYERS_ONLY === "1") {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const [{ data: users }, { data: channels }] = await Promise.all([
      query.graph({ entity: "user", fields: ["id"], filters: { email: tenant.actors.filter(({ role }) => role === "admin").map(({ email }) => email) } }),
      query.graph({ entity: "sales_channel", fields: ["id"], filters: { name: [`${fixture.namespace}_${tenantKey}_baseline`, tenant.channelName] } }),
    ])
    const createdBy = (users[0] as { id?: string } | undefined)?.id
    const channelIds = (channels as Array<{ id?: string }>).flatMap(({ id }) => id ? [id] : [])
    if (!createdBy || channelIds.length !== 2) throw new Error("Existing Change Desk admin and sales channels are required for buyer-only provisioning")
    await provisionBuyers(container, tenantKey, createdBy, channelIds)
    return
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const collisions = await Promise.all([
    query.graph({ entity: "product", fields: ["id"], filters: { handle: fixture.products.map((item) => `changedesk-lab-${tenantKey}-${item.key}`) } }),
    query.graph({ entity: "product_category", fields: ["id"], filters: { handle: [`changedesk-lab-${tenantKey}-baseline`, tenant.categoryHandle] } }),
    query.graph({ entity: "sales_channel", fields: ["id"], filters: { name: [`${fixture.namespace}_${tenantKey}_baseline`, tenant.channelName] } }),
    query.graph({ entity: "user", fields: ["id"], filters: { email: tenant.actors.map(({ email }) => email) } }),
  ])
  if (collisions.some(({ data }) => data.length)) throw new Error("Change Desk seed namespace already exists; refusing to overwrite")

  const runId = randomUUID()
  const evidenceDir = path.resolve(process.cwd(), "../../evidence/local")
  await mkdir(evidenceDir, { recursive: true })
  const mapPath = path.join(evidenceDir, `seed-map.${tenantKey}.json`)
  try {
    await readFile(mapPath)
    throw new Error("Private seed map already exists; refusing to overwrite")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const progressPath = path.join(evidenceDir, `seed-run.${tenantKey}.${runId}.json`)
  const progress: {
    runId: string
    tenant: string
    status: "started" | "failed" | "completed"
    created: { categoryIds: string[]; channelIds: string[]; tagIds: string[]; productIds: string[]; userIds: string[] }
    updatedAt: string
    errorCode?: "seed_failed"
  } = {
    runId,
    tenant: tenantKey,
    status: "started",
    created: { categoryIds: [], channelIds: [], tagIds: [], productIds: [], userIds: [] },
    updatedAt: new Date().toISOString(),
  }
  const checkpoint = async () => {
    progress.updatedAt = new Date().toISOString()
    await writeFile(progressPath, JSON.stringify(progress, null, 2), { mode: 0o600 })
  }
  await checkpoint()

  try {
    const { result: categories } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: [
          { name: `${fixture.namespace}_${tenantKey}_baseline`, handle: `changedesk-lab-${tenantKey}-baseline`, is_active: true },
          { name: `${fixture.namespace}_${tenantKey}_campaign`, handle: tenant.categoryHandle, is_active: true },
        ],
      },
    })
    const [baseCategory, campaignCategory] = categories
    progress.created.categoryIds = categories.map(({ id }) => id)
    await checkpoint()
    const { result: channels } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [
          { name: `${fixture.namespace}_${tenantKey}_baseline`, is_disabled: false },
          { name: tenant.channelName, is_disabled: false },
        ],
      },
    })
    const [baseChannel, campaignChannel] = channels
    progress.created.channelIds = channels.map(({ id }) => id)
    await checkpoint()
    const { result: tags } = await createProductTagsWorkflow(container).run({
      input: { product_tags: [{ value: "baseline" }, { value: "preserve-me" }] },
    })
    progress.created.tagIds = tags.map(({ id }) => id)
    await checkpoint()
    const { result: products } = await createProductsWorkflow(container).run({
      input: {
        products: fixture.products.map((item, index) => ({
          title: `${tenantKey.toUpperCase()} ${item.key}`,
          handle: `changedesk-lab-${tenantKey}-${item.key}`,
          description: item.description,
          status: item.status,
          metadata: { changedesk_fixture: true, changedesk_key: item.key, changedesk_locked: item.locked },
          tags: tags.map((tag) => ({ id: tag.id })),
          categories: [baseCategory, ...(item.campaignCategory ? [campaignCategory] : [])].map(({ id }) => ({ id })),
          sales_channels: [baseChannel, ...(item.campaignChannel ? [campaignChannel] : [])].map(({ id }) => ({ id })),
          options: [{ title: "Default", values: ["Default"] }],
          variants: [{
            title: "Default",
            sku: `CD-${tenantKey.toUpperCase()}-${item.key.toUpperCase()}`,
            options: { Default: "Default" },
            manage_inventory: false,
            prices: [{ currency_code: tenant.currency, amount: tenant.basePrice + index + 1 }],
          }],
        })),
      },
    })

    progress.created.productIds = products.map(({ id }) => id)
    await checkpoint()

    const auth = container.resolve(Modules.AUTH) as IAuthModuleService
    const credentials: Record<string, { email: string; password: string }> = {}
    const users: Record<string, string> = {}
    for (const actor of tenant.actors) {
      const generatedPassword = password()
      const registered = await auth.register("emailpass", {
        url: "http://127.0.0.1/auth/user/emailpass/register",
        headers: {}, query: {}, protocol: "http",
        body: { email: actor.email, password: generatedPassword },
      })
      if (!registered.success || !registered.authIdentity?.id) throw new Error(`Could not register ${actor.key}`)
      const { result: user } = await createUserAccountWorkflow(container).run({
        input: {
          authIdentityId: registered.authIdentity.id,
          userData: {
            email: actor.email,
            first_name: actor.role,
            last_name: tenantKey,
            metadata: {
              changedesk: { managed: true, active: true, role: actor.role, policyVersion: "changedesk-lab-v1", hostSessionId: "not-bootstrapped", readableProductIds: products.map((product) => product.id) },
            },
          },
        },
      })
      users[actor.key] = user.id
      credentials[actor.key] = { email: actor.email, password: generatedPassword }
      progress.created.userIds.push(user.id)
      await checkpoint()
    }
    const buyerFixtures = await provisionBuyers(container, tenantKey, users[`${tenantKey}.admin`]!, channels.map(({ id }) => id))

    const localDir = path.resolve(process.cwd(), ".local")
    await mkdir(localDir, { recursive: true })
    await writeFile(path.join(localDir, `credentials.${tenantKey}.json`), JSON.stringify(credentials, null, 2), { mode: 0o600, flag: "wx" })
    await writeFile(mapPath, JSON.stringify({
      runId,
      tenant: tenantKey,
      users,
      buyers: buyerFixtures.buyers,
      publishableApiKey: buyerFixtures.publishableApiKey,
      products: Object.fromEntries(products.map((item, index) => [fixture.products[index].key, item.id])),
      categories: { baseline: baseCategory.id, campaign: campaignCategory.id },
      channels: { baseline: baseChannel.id, campaign: campaignChannel.id },
    }, null, 2), { mode: 0o600, flag: "wx" })
    progress.status = "completed"
    await checkpoint()
  } catch (error) {
    progress.status = "failed"
    progress.errorCode = "seed_failed"
    await checkpoint()
    throw error
  }
}
