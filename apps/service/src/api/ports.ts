import type { ActorContext } from "../runtime/types.js";

export interface MutationContext { actor: ActorContext; idempotencyKey: string; requestHash: string }
export interface ApiOperations {
  authorizeEffectClaim(input: Record<string, unknown>): Promise<unknown>;
  createRequest(context: MutationContext, input: unknown): Promise<unknown>;
  getRequest(actor: ActorContext, id: string): Promise<unknown | null>;
  addMessage(context: MutationContext, id: string, input: unknown): Promise<unknown>;
  getCandidates(actor: ActorContext, id: string): Promise<unknown | null>;
  selectCandidate(context: MutationContext, id: string, input: unknown): Promise<unknown>;
  getResources(actor: ActorContext, kind: "category" | "channel", query: { cursor?: string; limit?: number }): Promise<unknown>;
  createPlan(context: MutationContext, input: unknown): Promise<unknown>;
  getPlan(actor: ActorContext, id: string): Promise<unknown | null>;
  createApproval(context: MutationContext, input: unknown): Promise<unknown>;
  startExecution(context: MutationContext, input: unknown): Promise<unknown>;
  getExecution(actor: ActorContext, id: string): Promise<unknown | null>;
  cancelExecution(context: MutationContext, id: string): Promise<unknown | null>;
  resumeExecution(context: MutationContext, id: string): Promise<unknown | null>;
  getInstallations(actor: ActorContext): Promise<unknown>;
  createInstallation(context: MutationContext, input: unknown): Promise<unknown>;
  disableInstallation(context: MutationContext, id: string): Promise<unknown | null>;
  createPublication(context: MutationContext, input: unknown): Promise<unknown>;
  withdrawPublication(context: MutationContext, id: string): Promise<unknown | null>;
  revokePublication(context: MutationContext, id: string, input: unknown): Promise<unknown | null>;
  getEvidence(actor: ActorContext, id: string): Promise<unknown | null>;
}
