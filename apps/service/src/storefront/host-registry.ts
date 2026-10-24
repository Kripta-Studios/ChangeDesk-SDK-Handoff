import { createPublicKey } from "node:crypto";
import type { HostConfig } from "../config.js";
import type { BuyerHostIdentityPort } from "./session.js";

export class ConfiguredBuyerHostRegistry implements BuyerHostIdentityPort {
  readonly #hosts = new Map<string, HostConfig>();
  constructor(hosts: readonly HostConfig[], private readonly fetchImplementation: typeof fetch = fetch) {
    for (const host of hosts) this.#hosts.set(host.tenantId, host);
  }
  async publicKey(issuer: string) {
    const host = [...this.#hosts.values()].find((item) => item.issuer === issuer);
    if (!host) throw new Error("Unknown storefront host issuer");
    return createPublicKey(host.bootstrapPublicKeyPem);
  }
  async reauthorizeBuyer(input: { issuer: string; tenantId: string; buyerId: string; hostSessionId: string; policyVersion: string }) {
    const host = this.#hosts.get(input.tenantId);
    if (!host || host.issuer !== input.issuer) return { active: false, policyVersion: "" };
    const url = new URL(host.reauthorizeUrl);
    url.pathname = "/changedesk/bridge/v1/storefront/authorize"; url.search = ""; url.hash = "";
    const response = await this.fetchImplementation(url, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${host.serviceToken}`, "content-type": "application/json" }, body: JSON.stringify({ buyerId: input.buyerId, hostSessionId: input.hostSessionId, policyVersion: input.policyVersion }), signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return { active: false, policyVersion: "" };
    const body = await response.json() as { active?: unknown; policyVersion?: unknown };
    return { active: body.active === true, policyVersion: typeof body.policyVersion === "string" ? body.policyVersion : "" };
  }
}
