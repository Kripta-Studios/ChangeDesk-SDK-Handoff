import { createPublicKey, sign, verify, type KeyLike } from "node:crypto";
import type { Recipe, RecipeKey } from "@changedesk/contracts";
import type { CanonicalEncoder, PublicationSigner } from "./catalog-repository.js";
import { CatalogValidationError } from "./types.js";
import { canonicalizeJson } from "../core/hashing.js";

const GENERIC_COPY: Readonly<Record<RecipeKey, { displayName: string; description: string; uiLabel: string }>> = {
  "catalog.campaign.prepare.v1": {
    displayName: "Prepare catalog campaign",
    description: "Adds selected published products to an existing category and sales channel.",
    uiLabel: "Prepare campaign",
  },
  "catalog.category.assign.v1": {
    displayName: "Assign category",
    description: "Adds selected published products to an existing category.",
    uiLabel: "Assign category",
  },
  "catalog.channel.assign.v1": {
    displayName: "Assign sales channel",
    description: "Adds selected published products to an existing sales channel.",
    uiLabel: "Assign sales channel",
  },
};

const CATEGORY_FIELD = { name: "categoryId", control: "resource-picker", label: "Category" } as const;
const CHANNEL_FIELD = { name: "channelId", control: "resource-picker", label: "Sales channel" } as const;

/** Reconstructs shareable data from a finite allowlist. No source copy or tenant text survives. */
export function sanitizeRecipeForPublication(source: Recipe): Recipe {
  const copy = GENERIC_COPY[source.recipeKey];
  if (!copy || source.compatibility.adapter !== "medusa-v2" || source.compatibility.capabilityContract !== "1") {
    throw new CatalogValidationError("PUBLICATION_NOT_GENERIC", "Recipe is outside the publishable catalog");
  }
  if (source.compatibility.verifiedMedusaVersion !== "2.22.1") {
    throw new CatalogValidationError("PUBLICATION_UNVERIFIED_VERSION", "Recipe targets an unverified Medusa version");
  }

  const sanitized = canonicalGenericRecipe(source.recipeKey);
  if (canonicalizeJson(semanticProjection(source)) !== canonicalizeJson(semanticProjection(sanitized))) {
    throw new CatalogValidationError("PUBLICATION_SEMANTICS_MISMATCH", "Recipe semantics do not match its finite catalog key");
  }
  return sanitized;
}

export function canonicalGenericRecipe(recipeKey: RecipeKey): Recipe {
  const copy = GENERIC_COPY[recipeKey];
  if (recipeKey === "catalog.campaign.prepare.v1") return campaignRecipe(copy);
  if (recipeKey === "catalog.category.assign.v1") return categoryRecipe(copy);
  return channelRecipe(copy);
}

function semanticProjection(recipe: Recipe) {
  return { schemaVersion:recipe.schemaVersion, recipeKey:recipe.recipeKey, compatibility:recipe.compatibility,
    parameters:recipe.parameters, selection:recipe.selection, requiredCapabilities:[...recipe.requiredCapabilities].sort(),
    steps:recipe.steps.map((step)=>({...step,dependsOn:[...step.dependsOn].sort()})),
    ui:{kind:recipe.ui.kind,fields:recipe.ui.fields.map(({name,control})=>({name,control})).sort((left,right)=>left.name.localeCompare(right.name))} };
}

function base(copy: (typeof GENERIC_COPY)[RecipeKey]) {
  return {
    schemaVersion: "1.0" as const,
    displayName: copy.displayName,
    description: copy.description,
    compatibility: { adapter: "medusa-v2" as const, capabilityContract: "1" as const, verifiedMedusaVersion: "2.22.1" },
    selection: { resource: "medusa.product" as const, maxRecords: 100, requireStatus: "published" as const },
  };
}

function categoryRecipe(copy: (typeof GENERIC_COPY)[RecipeKey]): Recipe {
  return { ...base(copy), recipeKey: "catalog.category.assign.v1",
    parameters: { categoryId: { kind: "resource", resource: "medusa.product_category" } },
    requiredCapabilities: ["medusa.products.list", "medusa.products.retrieve", "medusa.product_categories.retrieve", "medusa.product_categories.products.add"],
    steps: [{ id: "addCategory", capability: "medusa.product_categories.products.add", forEach: "selectedProducts", dependsOn: [], arguments: { productId: { $record: "id" }, categoryId: { $param: "categoryId" } } }],
    ui: { kind: "action", label: copy.uiLabel, fields: [CATEGORY_FIELD] } };
}
function channelRecipe(copy: (typeof GENERIC_COPY)[RecipeKey]): Recipe {
  return { ...base(copy), recipeKey: "catalog.channel.assign.v1",
    parameters: { channelId: { kind: "resource", resource: "medusa.sales_channel" } },
    requiredCapabilities: ["medusa.products.list", "medusa.products.retrieve", "medusa.sales_channels.retrieve", "medusa.sales_channels.products.add"],
    steps: [{ id: "addChannel", capability: "medusa.sales_channels.products.add", forEach: "selectedProducts", dependsOn: [], arguments: { productId: { $record: "id" }, channelId: { $param: "channelId" } } }],
    ui: { kind: "action", label: copy.uiLabel, fields: [CHANNEL_FIELD] } };
}
function campaignRecipe(copy: (typeof GENERIC_COPY)[RecipeKey]): Recipe {
  return { ...base(copy), recipeKey: "catalog.campaign.prepare.v1",
    parameters: { categoryId: { kind: "resource", resource: "medusa.product_category" }, channelId: { kind: "resource", resource: "medusa.sales_channel" } },
    requiredCapabilities: ["medusa.products.list", "medusa.products.retrieve", "medusa.product_categories.retrieve", "medusa.sales_channels.retrieve", "medusa.product_categories.products.add", "medusa.sales_channels.products.add"],
    steps: [
      { id: "addCategory", capability: "medusa.product_categories.products.add", forEach: "selectedProducts", dependsOn: [], arguments: { productId: { $record: "id" }, categoryId: { $param: "categoryId" } } },
      { id: "addChannel", capability: "medusa.sales_channels.products.add", forEach: "selectedProducts", dependsOn: ["addCategory"], arguments: { productId: { $record: "id" }, channelId: { $param: "channelId" } } },
    ], ui: { kind: "action", label: copy.uiLabel, fields: [CATEGORY_FIELD, CHANNEL_FIELD] } };
}

export interface SignatureEnvelope {
  readonly domain: "changedesk.publication.v1";
  readonly artifactHash: string;
  readonly version: "1";
  readonly publisherTenantId: string;
  readonly visibility: "provider_catalog" | "shared_allowlist";
  readonly allowedTenantIds: readonly string[];
}

export function publicationEnvelope(input: Omit<SignatureEnvelope, "domain" | "version">): SignatureEnvelope {
  return { domain: "changedesk.publication.v1", version: "1", ...input, allowedTenantIds: [...input.allowedTenantIds].sort() };
}

export function verifyPublicationSignature(publicKeyDer: Uint8Array, envelope: SignatureEnvelope, signature: Uint8Array, encoder: CanonicalEncoder): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyDer), format: "der", type: "spki" });
    return verify(null, encoder.encode(envelope), key, signature);
  } catch { return false; }
}

export class NodeEd25519Signer implements PublicationSigner {
  constructor(private readonly keys: ReadonlyMap<string, KeyLike>) {}
  async sign(keyId: string, canonicalEnvelope: Uint8Array): Promise<Uint8Array> {
    const key = this.keys.get(keyId);
    if (!key) throw new CatalogValidationError("PUBLICATION_KEY_UNAVAILABLE", "Publication signing key is unavailable");
    return sign(null, canonicalEnvelope, key);
  }
}
