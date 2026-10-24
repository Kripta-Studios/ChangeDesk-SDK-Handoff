import type { CreateStorefrontProposalInput, ReplaceStorefrontPreferencesInput, StorefrontAdminProposalPreview, StorefrontPreferencesResponse, StorefrontProposalView } from "../../../contracts/src/storefront.js";

export type StorefrontSession = { accessToken: string; expiresAt: string };
export type StorefrontClientOptions = { endpoint: string; getSession: () => Promise<StorefrontSession>; fetch?: typeof fetch; now?: () => number };

export interface StorefrontClient {
  getPreferences(signal?: AbortSignal): Promise<StorefrontPreferencesResponse>;
  replacePreferences(input: ReplaceStorefrontPreferencesInput, signal?: AbortSignal): Promise<StorefrontPreferencesResponse>;
  createGlobalProposal(input: CreateStorefrontProposalInput, signal?: AbortSignal): Promise<StorefrontProposalView>;
  getOwnProposal(id: string, signal?: AbortSignal): Promise<StorefrontProposalView>;
  clearSession(): void;
}

export interface StorefrontAdminClient {
  listProposals(signal?: AbortSignal): Promise<{ proposals: readonly StorefrontAdminProposalPreview[] }>;
  getProposal(id: string, signal?: AbortSignal): Promise<StorefrontAdminProposalPreview>;
  approveProposal(id: string, expectedProposalRevision: number, expectedGlobalRevision: number, signal?: AbortSignal): Promise<StorefrontAdminProposalPreview>;
  rejectProposal(id: string, expectedProposalRevision: number, signal?: AbortSignal): Promise<StorefrontAdminProposalPreview>;
  clearSession(): void;
}

export class StorefrontApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = "StorefrontApiError"; }
}

const unavailable = async (): Promise<never> => { throw new StorefrontApiError(501, "not_implemented", "Storefront client not implemented"); };
export function createStorefrontClient(_options: StorefrontClientOptions): StorefrontClient { return { getPreferences: unavailable, replacePreferences: unavailable, createGlobalProposal: unavailable, getOwnProposal: unavailable, clearSession() {} }; }
export function createStorefrontAdminClient(_options: StorefrontClientOptions): StorefrontAdminClient { return { listProposals: unavailable, getProposal: unavailable, approveProposal: unavailable, rejectProposal: unavailable, clearSession() {} }; }
