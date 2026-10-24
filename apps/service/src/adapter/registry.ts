import { createPrivateKey, createPublicKey } from "node:crypto";
import type { HostConfig } from "../config.js";
import type { BridgeRegistration, BridgeRegistry } from "./bridge-connector.js";
import type { HostIdentityPort } from "../api/session.js";
import type { Role } from "../runtime/types.js";

export class ConfiguredHostRegistry implements BridgeRegistry, HostIdentityPort {
  readonly #hosts = new Map<string, HostConfig>();
  constructor(hosts: readonly HostConfig[], private readonly fetchImplementation: typeof fetch = fetch) { for (const host of hosts) { if (this.#hosts.has(host.tenantId)) throw new Error("Duplicate host tenant"); this.#hosts.set(host.tenantId, host); } }
  async get(tenantId: string): Promise<BridgeRegistration | null> { const host = this.#hosts.get(tenantId); return host ? { tenantId, issuer: host.issuer, audience: host.audience, commandUrl: host.commandUrl, privateKey: createPrivateKey(host.delegationPrivateKeyPem) } : null; }
  async publicKey(issuer: string) { const host = [...this.#hosts.values()].find((item) => item.issuer === issuer); if (!host) throw new Error("Unknown host issuer"); return createPublicKey(host.bootstrapPublicKeyPem); }
  async reauthorize(input: { issuer: string; tenantId: string; actorId: string; hostSessionId: string; policyVersion: string }): Promise<{ active: boolean; roles: readonly Role[]; policyVersion: string }> {
    const host = this.#hosts.get(input.tenantId); if (!host || host.issuer !== input.issuer) return { active: false, roles: [], policyVersion: "" };
    const response = await this.fetchImplementation(host.reauthorizeUrl, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${host.serviceToken}`, "content-type": "application/json" }, body: JSON.stringify({ actorId: input.actorId, hostSessionId: input.hostSessionId, policyVersion: input.policyVersion }), signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return { active: false, roles: [], policyVersion: "" };
    const body = await response.json() as any; const roles = Array.isArray(body.roles) ? body.roles.filter((role: unknown): role is Role => ["viewer","requester","operator","admin"].includes(String(role))) : [];
    return { active: body.active === true, roles, policyVersion: typeof body.policyVersion === "string" ? body.policyVersion : "" };
  }
}
