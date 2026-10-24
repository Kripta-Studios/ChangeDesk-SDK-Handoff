import type { CapabilityId, Permission } from "@changedesk/contracts";

export interface CapabilityDefinition {
  readonly id: CapabilityId;
  readonly version: "1";
  readonly permission: Permission;
  readonly effect: "read" | "additive_association";
  readonly retry: "read_retryable" | "reconcile_before_retry";
}

export const CAPABILITY_MANIFEST: Readonly<Record<CapabilityId, CapabilityDefinition>> = Object.freeze({
  "medusa.products.list": Object.freeze({ id: "medusa.products.list", version: "1", permission: "read", effect: "read", retry: "read_retryable" }),
  "medusa.products.retrieve": Object.freeze({ id: "medusa.products.retrieve", version: "1", permission: "read", effect: "read", retry: "read_retryable" }),
  "medusa.product_categories.retrieve": Object.freeze({ id: "medusa.product_categories.retrieve", version: "1", permission: "read", effect: "read", retry: "read_retryable" }),
  "medusa.sales_channels.retrieve": Object.freeze({ id: "medusa.sales_channels.retrieve", version: "1", permission: "read", effect: "read", retry: "read_retryable" }),
  "medusa.product_categories.products.add": Object.freeze({ id: "medusa.product_categories.products.add", version: "1", permission: "execute", effect: "additive_association", retry: "reconcile_before_retry" }),
  "medusa.sales_channels.products.add": Object.freeze({ id: "medusa.sales_channels.products.add", version: "1", permission: "execute", effect: "additive_association", retry: "reconcile_before_retry" }),
});

export function isCapabilityId(value: string): value is CapabilityId {
  return Object.hasOwn(CAPABILITY_MANIFEST, value);
}
