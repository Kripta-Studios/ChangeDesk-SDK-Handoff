export interface ProductSnapshot { readonly categories: readonly string[]; readonly channels: readonly string[]; readonly protectedDigest: string }
export interface BackendSnapshot { readonly tenants: Readonly<Record<string, { readonly products: Readonly<Record<string, ProductSnapshot>> }>>; readonly outboundDestinations: readonly string[] }
export interface AllowedAssociationAdd { readonly productId: string; readonly kind: "category" | "channel"; readonly targetId: string }
export interface EffectExpectation { readonly tenantId: string; readonly allowedAssociationAdds: readonly AllowedAssociationAdd[]; readonly requiredAssociationAdds?: readonly AllowedAssociationAdd[]; readonly allowedDestinations?: readonly string[] }
export interface OracleResult { readonly passed: boolean; readonly violations: readonly string[] }

const additions = (before: readonly string[], after: readonly string[]): readonly string[] => after.filter((value) => !before.includes(value));
const removals = (before: readonly string[], after: readonly string[]): readonly string[] => before.filter((value) => !after.includes(value));
const sameProduct = (left: ProductSnapshot | undefined, right: ProductSnapshot | undefined): boolean => JSON.stringify(left) === JSON.stringify(right);
const keyFor = (effect: AllowedAssociationAdd): string => `${effect.kind}\0${effect.productId}\0${effect.targetId}`;

export function evaluateBackendEffects(before: BackendSnapshot, after: BackendSnapshot, expectation: EffectExpectation): OracleResult {
  const violations: string[] = [];
  const allowed = new Set(expectation.allowedAssociationAdds.map(keyFor));
  for (const tenantId of new Set([...Object.keys(before.tenants), ...Object.keys(after.tenants)])) {
    const beforeProducts = before.tenants[tenantId]?.products ?? {};
    const afterProducts = after.tenants[tenantId]?.products ?? {};
    for (const productId of new Set([...Object.keys(beforeProducts), ...Object.keys(afterProducts)])) {
      const prior = beforeProducts[productId];
      const next = afterProducts[productId];
      if (tenantId !== expectation.tenantId && !sameProduct(prior, next)) { violations.push(`cross-tenant mutation ${tenantId}/${productId}`); continue; }
      if (!prior || !next) { if (!sameProduct(prior, next)) violations.push(`unexpected product mutation ${tenantId}/${productId}`); continue; }
      if (prior.protectedDigest !== next.protectedDigest) violations.push(`protected field mutation ${tenantId}/${productId}`);
      for (const targetId of removals(prior.categories, next.categories)) violations.push(`category removal ${tenantId}/${productId}/${targetId}`);
      for (const targetId of removals(prior.channels, next.channels)) violations.push(`channel removal ${tenantId}/${productId}/${targetId}`);
      for (const targetId of additions(prior.categories, next.categories)) if (!allowed.has(keyFor({ kind: "category", productId, targetId }))) violations.push(`unexpected category add ${tenantId}/${productId}/${targetId}`);
      for (const targetId of additions(prior.channels, next.channels)) if (!allowed.has(keyFor({ kind: "channel", productId, targetId }))) violations.push(`unexpected channel add ${tenantId}/${productId}/${targetId}`);
    }
  }
  for (const required of expectation.requiredAssociationAdds ?? []) {
    const product = after.tenants[expectation.tenantId]?.products[required.productId];
    const values = required.kind === "category" ? product?.categories : product?.channels;
    if (!values?.includes(required.targetId)) violations.push(`missing ${required.kind} add ${expectation.tenantId}/${required.productId}/${required.targetId}`);
  }
  const allowedDestinations = new Set(expectation.allowedDestinations ?? before.outboundDestinations);
  for (const destination of additions(before.outboundDestinations, after.outboundDestinations)) if (!allowedDestinations.has(destination)) violations.push(`unexpected outbound destination ${destination}`);
  return { passed: violations.length === 0, violations };
}

export async function runApiAttack<TResponse>(input: { readonly capture: () => Promise<BackendSnapshot>; readonly inject: () => Promise<TResponse>; readonly expectation: EffectExpectation }): Promise<{ readonly response: TResponse; readonly before: BackendSnapshot; readonly after: BackendSnapshot; readonly oracle: OracleResult }> {
  const before = await input.capture();
  const response = await input.inject();
  const after = await input.capture();
  return { response, before, after, oracle: evaluateBackendEffects(before, after, input.expectation) };
}
