import type { ExecArgs, IAuthModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createProductTagsWorkflow,
  createSalesChannelsWorkflow,
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

export default async function seed({ container }: ExecArgs) {
  const tenantKey = process.env.CHANGEDESK_TENANT_ID
  if (tenantKey !== "atlas" && tenantKey !== "boreal") throw new Error("CHANGEDESK_TENANT_ID must be atlas or boreal")
  const fixturePath = path.resolve(process.cwd(), "../../fixtures/medusa-scenarios.json")
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture
  const tenant = fixture.tenants.find((item) => item.key === tenantKey)
  if (!tenant) throw new Error("Tenant fixture not found")
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

    const localDir = path.resolve(process.cwd(), ".local")
    await mkdir(localDir, { recursive: true })
    await writeFile(path.join(localDir, `credentials.${tenantKey}.json`), JSON.stringify(credentials, null, 2), { mode: 0o600, flag: "wx" })
    await writeFile(mapPath, JSON.stringify({
      runId,
      tenant: tenantKey,
      users,
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
