import { randomUUID, sign, type KeyObject } from "node:crypto";
import { canonicalizeJson, hashCanonical } from "../core/hashing.js";
import { ConnectorError } from "../runtime/worker.js";
import type { ActorContext, Capability, EffectCommand, HostConnector, ReconcileCommand } from "../runtime/types.js";

export interface BridgeRegistration {
  tenantId: string;
  issuer: string;
  audience: string;
  commandUrl: string;
  privateKey: KeyObject;
}
export interface BridgeRegistry { get(tenantId: string): Promise<BridgeRegistration | null> }

export class SignedBridgeConnector implements HostConnector {
  constructor(private readonly registry: BridgeRegistry, private readonly fetchImplementation: typeof fetch = fetch, private readonly clock: () => Date = () => new Date()) {}

  async readAuthorized(command: { capability: Capability; args: unknown; actor: ActorContext }): Promise<unknown> {
    const registration = await this.registration(command.actor.tenantId);
    const now = Math.floor(this.clock().getTime() / 1000);
    const claims = {
      v: 1, typ: "changedesk.read", iss: registration.issuer, aud: registration.audience,
      tenantId: command.actor.tenantId, actorId: command.actor.actorId, hostSessionId: command.actor.hostSessionId,
      policyVersion: command.actor.policyVersion, adapterVersion: "medusa-2.22.1/changedesk-1",
      capability: command.capability, argsHash: digestArgs(command.args), jti: randomUUID(), iat: now, exp: now + 30, requestId: randomUUID(),
    } as const;
    return this.call(registration, claims, { capability: command.capability, args: command.args });
  }

  async executeAuthorized(command: EffectCommand): Promise<{ receipt: unknown; observed: boolean }> {
    const registration = await this.registration(command.tenantId);
    const now = Math.floor(this.clock().getTime() / 1000);
    const claims = {
      v: 1, typ: "changedesk.effect", iss: registration.issuer, aud: registration.audience, tenantId: command.tenantId,
      actorId: command.actorId, hostSessionId: command.hostSessionId, policyVersion: command.policyVersion, adapterVersion: command.adapterVersion,
      capability: command.capability, argsHash: command.argsHash, jti: randomUUID(), iat: now, exp: now + 30,
      executionId: command.executionId, rowId: command.rowId, stepId: command.stepId,
      planId: command.planId, planHash: command.planHash, planVersion: command.planVersion, approvalId: command.approvalId,
      approvalExpiresAt: command.approvalExpiresAt, semanticInputHash: command.semanticInputHash,
      operationKey: command.operationKey, jobId: command.jobId, leaseOwner: command.leaseOwner, fence: command.fence, preconditions: command.preconditions,
    } as const;
    return await this.call(registration, claims, { capability: command.capability, args: command.args }) as { receipt: unknown; observed: boolean };
  }

  async reconcileOperation(command: ReconcileCommand) {
    const registration = await this.registration(command.tenantId);
    const now = Math.floor(this.clock().getTime() / 1000);
    const claims = {
      v: 1, typ: "changedesk.reconcile", iss: registration.issuer, aud: registration.audience, tenantId: command.tenantId,
      adapterVersion: "medusa-2.22.1/changedesk-1", capability: command.capability, argsHash: command.argsHash,
      executionId: command.executionId, rowId: command.rowId, stepId: command.stepId, operationKey: command.operationKey, semanticInputHash: command.semanticInputHash,
      jti: randomUUID(), iat: now, exp: now + 30,
    } as const;
    const result = await this.call(registration, claims, { operationKey: command.operationKey }) as { status: "confirmed" | "no_effect" | "unknown"; postcondition: boolean };
    return result.status === "confirmed" ? { state: "confirmed" as const, receipt: result } : { state: result.status };
  }

  private async registration(tenantId: string): Promise<BridgeRegistration> {
    const registration = await this.registry.get(tenantId);
    if (!registration) throw new ConnectorError("bridge_not_configured", "not_sent", "Bridge is not configured");
    const url = new URL(registration.commandUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new ConnectorError("bridge_url_invalid", "not_sent", "Bridge URL is not allowed");
    return registration;
  }

  private async call(registration: BridgeRegistration, claims: object, body: object): Promise<unknown> {
    const payload = Buffer.from(canonicalizeJson(claims), "utf8");
    const envelope = `${payload.toString("base64url")}.${sign(null, payload, registration.privateKey).toString("base64url")}`;
    let response: Response;
    try {
      response = await this.fetchImplementation(registration.commandUrl, {
        method: "POST", headers: { authorization: `ChangeDesk-Delegation ${envelope}`, "content-type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), redirect: "error",
      });
    } catch (error) {
      throw new ConnectorError("bridge_transport", "unknown", error instanceof Error ? error.message : "Bridge transport failed");
    }
    if (!response.ok) {
      const certainty = response.status >= 400 && response.status < 500 ? "not_sent" : "unknown";
      throw new ConnectorError(`bridge_http_${response.status}`, certainty, "Bridge rejected the command");
    }
    try { const envelope = await response.json() as { result?: unknown }; if (!("result" in envelope)) throw new Error("missing result"); return envelope.result; } catch { throw new ConnectorError("bridge_malformed_response", "unknown", "Bridge returned malformed JSON"); }
  }
}

function digestArgs(args: unknown): string {
  return hashCanonical("bridge-arguments", "1", args as object);
}
