import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SignedBridgeConnector } from "../../src/adapter/bridge-connector.js";
import { StorageApiOperations } from "../../src/api/storage-operations.js";
import { canonicalGenericRecipe } from "../../src/planner/publication.js";

const actor = { tenantId: "atlas", actorId: "operator", hostSessionId: "hs", roles: ["operator"], policyVersion: "p1", expiresAt: "2099-01-01T00:00:00Z" } as const;
const artifactHash = "a".repeat(64);
const manifestHash = "b".repeat(64);
const proofEnvironmentDigest = "0aed1f74bf00de83b25b565a54463767e550692b92fd242dd0397986e222be57";

describe("runtime completion invariants", () => {
  it("keeps an HTTP 409 effect response uncertain for reconciliation", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const connector = new SignedBridgeConnector(
      { get: vi.fn().mockResolvedValue({ tenantId: "atlas", issuer: "service-atlas", audience: "host", commandUrl: "http://localhost/commands", privateKey }) },
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "effect_unknown" } }), { status: 409, headers: { "content-type": "application/json" } })) as any,
    );

    await expect(connector.executeAuthorized(effectCommand())).rejects.toMatchObject({ code: "bridge_effect_unknown", certainty: "unknown" });
  });

  it("does not trust an unbounded host error body as an uncertainty code", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const body = JSON.stringify({ error: { code: "effect_unknown", padding: "x".repeat(5_000) } });
    const connector = new SignedBridgeConnector(
      { get: vi.fn().mockResolvedValue({ tenantId: "atlas", issuer: "service-atlas", audience: "host", commandUrl: "http://localhost/commands", privateKey }) },
      vi.fn().mockResolvedValue(new Response(body, { status: 409, headers: { "content-type": "application/json" } })) as any,
    );
    await expect(connector.executeAuthorized(effectCommand())).rejects.toMatchObject({ code: "bridge_http_409", certainty: "unknown" });
  });

  it("rejects a replan that selects a previously excluded product", async () => {
    const operations = operationsForPrior({
      selectionSnapshot: [{ productId: "pending" }],
      perRecordEffects: [priorEffect("pending")],
      exclusions: [{ recordId: "excluded", reason: "status" }],
    }, []);

    await expect(operations.createPlan(context(), planBody(["pending", "excluded"]))).rejects.toMatchObject({ code: "PRIOR_EXECUTION_SCOPE_MISMATCH" });
  });

  it("constrains a replan to exactly products with pending prior effects", async () => {
    const operations = operationsForPrior({
      selectionSnapshot: [{ productId: "confirmed" }, { productId: "pending" }],
      perRecordEffects: [priorEffect("confirmed"), priorEffect("pending")],
      exclusions: [],
    }, [{ row_id: "confirmed", step_id: "addCategory", state: "confirmed" }]);

    await expect(operations.createPlan(context(), planBody(["confirmed", "pending"]))).rejects.toMatchObject({ code: "PRIOR_EXECUTION_SCOPE_MISMATCH" });
    await expect(operations.createPlan(context(), planBody(["pending"]))).resolves.toMatchObject({ status: "ready" });
  });

  it("does not recreate a confirmed effect when another effect on the row remains pending", async () => {
    const operations = operationsForPrior({
      artifactHash, parameters: { categoryId: "category", channelId: "channel" }, selectionSnapshot: [{ productId: "product" }],
      perRecordEffects: [priorEffect("product"), { recordId: "product", stepId: "addChannel", capability: "medusa.sales_channels.products.add", arguments: { productId: "product", channelId: "channel" }, expected: "apply" }], exclusions: [],
    }, [{ row_id: "product", step_id: "addCategory", state: "confirmed" }, { row_id: "product", step_id: "addChannel", state: "rejected" }], false, "catalog.campaign.prepare.v1");

    await expect(operations.createPlan(context(), { installationId: "installation", priorExecutionId: "prior", selectedProductIds: ["product"], parameters: { categoryId: "category", channelId: "channel" } })).rejects.toMatchObject({ code: "PRIOR_EXECUTION_SCOPE_MISMATCH" });
  });

  it("binds trusted verified evidence to the final plan hash before persisting a ready plan", async () => {
    const recipe = canonicalGenericRecipe("catalog.category.assign.v1");
    const insertEvidence = vi.fn();
    const createPlan = vi.fn(async (input) => ({ id: input.id, state: input.state }));
    const publishAuthorized = vi.fn().mockResolvedValue({ publicationId: "publication" });
    const tx = {
      getActiveCapabilityManifest: vi.fn().mockResolvedValue({ manifestHash, body: { capabilityContract: "1", verifiedMedusaVersion: "2.22.1", capabilities: recipe.requiredCapabilities } }),
      getInstallationForPlan: vi.fn().mockResolvedValue({ installation: { id: "installation", status: "active" }, artifact: { artifactHash, canonicalBody: recipe } }),
      createInstalledActionRequest: vi.fn().mockResolvedValue({ id: "request" }), insertEvidence, createPlan, updateRequestState: vi.fn(),
      hasApplicableArtifactEvidence: vi.fn(async () => insertEvidence.mock.calls.some(([input]) => input.artifactRefs.bindingKind === "artifact" && input.status === "passed")),
    };
    const store = { withTenant: vi.fn(async (_scope, work) => work(tx)) };
    const connector = { readAuthorized: vi.fn(async ({ args }) => "categoryId" in args ? { id: "category" } : { id: args.productId, status: "published", categories: [], sales_channels: [], protectedDigest: "c".repeat(64) }) };
    const verifier = { verify: vi.fn(async (request) => ({ status: "verified", scope: request.scope, verifierVersion: "2.0.39", binarySha256: "2ec160fa4486d33aff51e9eedcc294d6b531dc10c279c00b0c00685dae2045cd", modelHash: "ac9d10d08692f9259301edf9d897ddb782eb403b98f1fbeff13b9e987baa1596", lawsHash: "02584a23199db88ec67974a4e458a0e7f16f8ed9196b8c1ba5b0a08cfa6937ac", proofHash: "827e041bc627ff9db7416e9f7f25693e08a170c9d1146330a4c9221c40a344ae", toolchainHash: proofEnvironmentDigest, exitCode: 0, stdout: "ALL PROOFS CHECK", stderr: "", durationMs: 1, ...request })) };
    const operations = new StorageApiOperations(store as any, connector as any, { atlas: { category: ["category"], channel: [] }, boreal: { category: [], channel: [] } }, { publishAuthorized } as any, "key", undefined, true, "unavailable", verifier as any, proofEnvironmentDigest);

    await expect(operations.createPlan(context(), { installationId: "installation", selectedProductIds: ["pending"], parameters: { categoryId: "category" } })).resolves.toMatchObject({ status: "ready" });
    const evidence = insertEvidence.mock.calls.find(([input]) => input.artifactRefs.bindingKind === "plan")![0];
    const artifactEvidence = insertEvidence.mock.calls.find(([input]) => input.artifactRefs.bindingKind === "artifact")?.[0];
    const persistedPlan = createPlan.mock.calls[0]![0];
    expect(persistedPlan.body.evidenceRefs).toEqual([evidence.id]);
    expect(evidence).toMatchObject({ artifactHash, environmentDigest: proofEnvironmentDigest, status: "passed", artifactRefs: { bindingKind: "plan", artifactHash, planHash: persistedPlan.planHash, policyVersion: "p1", scope: "association-set-laws-v1", recipeKey: "catalog.category.assign.v1" } });
    expect(verifier.verify).toHaveBeenCalledWith(expect.objectContaining({ artifactHash, planHash: persistedPlan.planHash, policyVersion: "p1", scope: "association-set-laws-v1" }));
    expect(artifactEvidence).toMatchObject({ artifactHash, environmentDigest: proofEnvironmentDigest, status: "passed", privacyScope: "generic", artifactRefs: { bindingKind: "artifact", artifactHash, policyVersion: "p1", scope: "association-set-laws-v1", recipeKey: "catalog.category.assign.v1" } });
    expect(artifactEvidence.artifactRefs).not.toHaveProperty("planHash");
    await expect(operations.createPublication(context(), { artifactHash, visibility: "shared_allowlist", allowedTenantIds: ["boreal"] })).resolves.toEqual({ publicationId: "publication" });
    expect(publishAuthorized).toHaveBeenCalledOnce();
  });

  it("fails closed when proof policy is required but no reviewed verifier is configured", async () => {
    const operations = operationsForPrior({ selectionSnapshot: [], perRecordEffects: [], exclusions: [], artifactHash, parameters: { categoryId: "category" } }, [], true);
    await expect(operations.createPlan(context(), { installationId: "installation", selectedProductIds: ["pending"], parameters: { categoryId: "category" } })).rejects.toMatchObject({ code: "PROOF_VERIFIER_UNAVAILABLE" });
  });

  it("rejects a verifier result whose exact server binding does not match the request", async () => {
    const operations = operationsForPrior({ selectionSnapshot: [], perRecordEffects: [], exclusions: [], artifactHash, parameters: { categoryId: "category" } }, [], true, "catalog.category.assign.v1", {
      verify: vi.fn(async (request) => ({ status: "verified", scope: request.scope, verifierVersion: "2.0.39", binarySha256: "2ec160fa4486d33aff51e9eedcc294d6b531dc10c279c00b0c00685dae2045cd", modelHash: "ac9d10d08692f9259301edf9d897ddb782eb403b98f1fbeff13b9e987baa1596", lawsHash: "02584a23199db88ec67974a4e458a0e7f16f8ed9196b8c1ba5b0a08cfa6937ac", proofHash: "827e041bc627ff9db7416e9f7f25693e08a170c9d1146330a4c9221c40a344ae", toolchainHash: proofEnvironmentDigest, exitCode: 0, stdout: "", stderr: "", durationMs: 1, ...request, artifactHash: "f".repeat(64) })),
    }, proofEnvironmentDigest);
    await expect(operations.createPlan(context(), { installationId: "installation", selectedProductIds: ["pending"], parameters: { categoryId: "category" } })).rejects.toMatchObject({ code: "PROOF_REQUIRED" });
  });

  it("does not admit execution or publication without exact current evidence", async () => {
    const tx = { hasApplicableApprovalEvidence: vi.fn().mockResolvedValue(false), hasApplicableArtifactEvidence: vi.fn().mockResolvedValue(false) };
    const store = { withTenant: vi.fn(async (_scope, work) => work(tx)) };
    const catalog = { publishAuthorized: vi.fn() };
    const operations = new StorageApiOperations(store as any, {} as any, { atlas: { category: [], channel: [] }, boreal: { category: [], channel: [] } }, catalog as any, "key", undefined, true, "unavailable", { verify: vi.fn() } as any, "e".repeat(64));

    await expect(operations.startExecution(context(), { approvalId: "approval" })).rejects.toMatchObject({ code: "PROOF_REQUIRED" });
    await expect(operations.createPublication(context(), { artifactHash, visibility: "shared_allowlist", allowedTenantIds: ["boreal"] })).rejects.toMatchObject({ code: "PROOF_REQUIRED" });
    expect(catalog.publishAuthorized).not.toHaveBeenCalled();
  });
});

function operationsForPrior(priorPlan: Record<string, unknown>, attempts: Record<string, unknown>[], proofRequired = false, recipeKey: "catalog.category.assign.v1" | "catalog.campaign.prepare.v1" = "catalog.category.assign.v1", verifier?: any, environmentDigest?: string) {
  const recipe = canonicalGenericRecipe(recipeKey);
  const tx = {
    getActiveCapabilityManifest: vi.fn().mockResolvedValue({ manifestHash, body: { capabilityContract: "1", verifiedMedusaVersion: "2.22.1", capabilities: recipe.requiredCapabilities } }),
    getExecutionDetail: vi.fn().mockResolvedValue({ execution: { actor_id: "operator", state: "partial" }, plan: { body: { artifactHash, parameters: { categoryId: "category" }, ...priorPlan } }, attempts }),
    getInstallationForPlan: vi.fn().mockResolvedValue({ installation: { id: "installation", status: "active" }, artifact: { artifactHash, canonicalBody: recipe } }),
    createInstalledActionRequest: vi.fn().mockResolvedValue({ id: "request" }), insertEvidence: vi.fn(),
    createPlan: vi.fn(async (input) => ({ id: input.id, state: input.state })),
    updateRequestState: vi.fn(),
  };
  const store = { withTenant: vi.fn(async (_scope, work) => work(tx)) };
  const connector = { readAuthorized: vi.fn(async ({ args }) => "categoryId" in args ? { id: "category" } : "channelId" in args ? { id: "channel" } : { id: args.productId, status: "published", categories: [], sales_channels: [], protectedDigest: "c".repeat(64) }) };
  return new StorageApiOperations(store as any, connector as any, { atlas: { category: ["category"], channel: ["channel"] } }, undefined, undefined, undefined, proofRequired, "unavailable", verifier, environmentDigest);
}

function priorEffect(recordId: string) {
  return { recordId, stepId: "addCategory", capability: "medusa.product_categories.products.add", arguments: { productId: recordId, categoryId: "category" }, expected: "apply" };
}

function context() { return { actor, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", requestHash: "d".repeat(64) }; }
function planBody(selectedProductIds: string[]) { return { installationId: "installation", priorExecutionId: "prior", selectedProductIds, parameters: { categoryId: "category" } }; }
function effectCommand() { return { tenantId: "atlas", actorId: "operator", hostSessionId: "hs", policyVersion: "p1", adapterVersion: "medusa-2.22.1/changedesk-1", capability: "medusa.product_categories.products.add", args: { productId: "p", categoryId: "c" }, argsHash: "a".repeat(64), executionId: "e", rowId: "p", stepId: "addCategory", planId: "plan", planHash: "b".repeat(64), planVersion: 1, approvalId: "approval", approvalExpiresAt: "2099-01-01T00:00:00Z", semanticInputHash: "c".repeat(64), operationKey: "operation", jobId: "job", leaseOwner: "worker", fence: 1, preconditions: { fingerprint: "d".repeat(64) } } as const; }
