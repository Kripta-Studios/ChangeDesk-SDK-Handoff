export interface BendProcessObservation {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly infrastructureFailure?: string;
}

export type ParsedBendVerdict =
  | { readonly status: "verified" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string };

export function parseBendVerdict(observation: BendProcessObservation): ParsedBendVerdict {
  if (observation.infrastructureFailure) return { status: "unavailable", reason: observation.infrastructureFailure };
  const combined = `${observation.stdout}\n${observation.stderr}`;
  if (/unsafe|foreign/iu.test(combined)) return { status: "failed", reason: "unsafe_or_foreign_code" };
  const allProofLines = observation.stdout.split(/\r?\n/u).filter((line) => line.trim() === "ALL PROOFS CHECK");
  if (observation.exitCode === 0 && allProofLines.length === 1 && !/SOME PROOFS FAIL/iu.test(combined)) return { status: "verified" };
  if (observation.exitCode === 0) return { status: "failed", reason: "ambiguous_or_missing_kernel_verdict" };
  return { status: "failed", reason: "proof_or_kernel_failure" };
}
