import { MedusaService } from "@medusajs/framework/utils"
import type { KeyObject } from "node:crypto"
import { BridgeError } from "../../bridge/errors.ts"
import { importPrivateKey, importPublicKey, newJti, signEnvelope } from "../../bridge/crypto.ts"
import { buildBootstrapClaims } from "../../bridge/validation.ts"
import type { BootstrapClaims, CapabilityId } from "../../bridge/types.ts"
import type { EffectDelegationClaims } from "../../bridge/types.ts"
import DelegationNonce from "./models/delegation-nonce.ts"
import OperationReceipt from "./models/operation-receipt.ts"

export type ChangeDeskModuleOptions = {
  installationId: string
  tenantId: string
  serviceAudience: string
  serviceIssuer: string
  bootstrapPrivateKeyPem: string
  servicePublicKeyPem: string
  allowedOrigins: string[]
  allowedCategoryIds: string[]
  allowedChannelIds: string[]
  authorityCheckUrl: string
  authorityCredential: string
}

export default class ChangeDeskModuleService extends MedusaService({
  DelegationNonce,
  OperationReceipt,
}) {
  private readonly options_: ChangeDeskModuleOptions
  private readonly bootstrapPrivateKey_: KeyObject
  private readonly servicePublicKey_: KeyObject
  private readonly locks_ = new Map<string, Promise<void>>()

  constructor(container: object, options: ChangeDeskModuleOptions) {
    super(...arguments)
    this.options_ = options
    this.bootstrapPrivateKey_ = importPrivateKey(options.bootstrapPrivateKeyPem)
    this.servicePublicKey_ = importPublicKey(options.servicePublicKeyPem)
  }

  getOptions() {
    return this.options_
  }

  getServicePublicKey() {
    return this.servicePublicKey_
  }

  issueBootstrapTicket(input: {
    actorId: string
    hostSessionId: string
    policyVersion: string
    origin: string
    now: number
  }): { ticket: string; claims: BootstrapClaims } {
    if (!this.options_.allowedOrigins.includes(input.origin)) {
      throw new BridgeError(403, "origin_forbidden", "Origin is not allowed")
    }
    const claims = buildBootstrapClaims({
      iss: this.options_.installationId,
      aud: this.options_.serviceAudience,
      sub: input.actorId,
      tenantId: this.options_.tenantId,
      hostSessionId: input.hostSessionId,
      policyVersion: input.policyVersion,
      origin: input.origin,
      jti: newJti(),
      iat: input.now,
      exp: input.now + 60,
    })
    return { ticket: signEnvelope(claims, this.bootstrapPrivateKey_), claims }
  }

  isAllowedDestination(capability: CapabilityId, destinationId: string) {
    if (capability.includes("product_categories")) {
      return this.options_.allowedCategoryIds.includes(destinationId)
    }
    if (capability.includes("sales_channels")) {
      return this.options_.allowedChannelIds.includes(destinationId)
    }
    return true
  }

  async consumeJti(jti: string, expiresAtSeconds: number) {
    try {
      await this.createDelegationNonces({
        jti,
        expires_at: new Date(expiresAtSeconds * 1000),
      })
    } catch {
      throw new BridgeError(409, "delegation_replay", "Delegation jti was already consumed")
    }
  }

  async assertCurrentAuthority(claims: EffectDelegationClaims) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2_000)
    let response: Response
    try {
      response = await fetch(this.options_.authorityCheckUrl, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-changedesk-host-credential": this.options_.authorityCredential,
        },
        body: JSON.stringify({
          tenantId: claims.tenantId,
          actorId: claims.actorId,
          executionId: claims.executionId,
          rowId: claims.rowId,
          stepId: claims.stepId,
          operationKey: claims.operationKey,
          fence: claims.fence,
          policyVersion: claims.policyVersion,
          planId: claims.planId,
          planVersion: claims.planVersion,
          planHash: claims.planHash,
          approvalId: claims.approvalId,
          approvalExpiresAt: claims.approvalExpiresAt,
          capability: claims.capability,
          argsHash: claims.argsHash,
          semanticInputHash: claims.semanticInputHash,
        }),
      })
    } catch {
      throw new BridgeError(503, "authority_unavailable", "Current execution authority is unavailable")
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok) throw new BridgeError(403, "authority_revoked", "Current execution authority was denied")
    const decision = await response.json() as { authorized?: boolean; fence?: number }
    if (decision.authorized !== true || decision.fence !== claims.fence) {
      throw new BridgeError(403, "authority_revoked", "Current execution authority was denied")
    }
  }

  async withResourceLock<T>(resource: string, action: () => Promise<T>): Promise<T> {
    const release = await this.acquireResourceLocks([resource])
    try {
      return await action()
    } finally {
      release()
    }
  }

  async acquireResourceLocks(resources: string[]): Promise<() => void> {
    const releases: (() => void)[] = []
    for (const resource of [...new Set(resources)].sort()) {
      releases.push(await this.acquireOneLock(resource))
    }
    return () => {
      for (const release of releases.reverse()) release()
    }
  }

  private async acquireOneLock(resource: string): Promise<() => void> {
    const previous = this.locks_.get(resource) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)
    this.locks_.set(resource, queued)
    await previous
    return () => {
      release()
      if (this.locks_.get(resource) === queued) this.locks_.delete(resource)
    }
  }
}
