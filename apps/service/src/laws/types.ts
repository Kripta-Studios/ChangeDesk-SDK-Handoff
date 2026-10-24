export const LAW_IDS = Object.freeze([
  "association_preserves_existing",
  "association_idempotent",
  "excluded_unchanged",
  "actions_subset_approved",
] as const);
export type LawId = (typeof LAW_IDS)[number];
export type LawVerificationStatus = "verified" | "failed" | "unavailable" | "not_applicable";

export interface LawVerificationRequest {
  readonly artifactHash: string;
  readonly planHash: string;
  readonly policyVersion: string;
  readonly scope: string;
}

export interface LawVerificationResult {
  readonly status: LawVerificationStatus;
  readonly scope: string;
  readonly verifierVersion: "2.0.39";
  readonly binarySha256: string;
  readonly modelHash?: string;
  readonly lawsHash?: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly reason?: string;
  readonly artifactHash: string;
  readonly planHash: string;
  readonly policyVersion: string;
}

export interface LawVerifier {
  verify(request: LawVerificationRequest, signal?: AbortSignal): Promise<LawVerificationResult>;
}
