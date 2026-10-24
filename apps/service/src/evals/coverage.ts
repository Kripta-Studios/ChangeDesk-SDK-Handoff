import type { AttackCase } from "./attack-corpus.js";

export type CoverageStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" | "NOT_APPLICABLE";
export interface CoverageObservation { readonly caseId: string; readonly lane: "deterministic" | "live"; readonly status: Exclude<CoverageStatus, "NOT_APPLICABLE">; readonly executed: boolean; readonly independentOracle: boolean; readonly evidence: readonly string[]; readonly limitation?: string }
interface LaneCoverage { readonly status: CoverageStatus; readonly evidence: readonly string[]; readonly limitation?: string }

export function buildCoverageReport(cases: readonly AttackCase[], observations: readonly CoverageObservation[]) {
  const byKey = new Map<string, CoverageObservation>();
  for (const observation of observations) {
    const key = `${observation.caseId}\0${observation.lane}`;
    if (byKey.has(key)) throw new TypeError(`duplicate coverage observation ${observation.caseId}/${observation.lane}`);
    if (observation.status === "PASS" && (!observation.executed || !observation.independentOracle || observation.evidence.length === 0)) throw new TypeError(`PASS requires executed independent oracle evidence for ${observation.caseId}/${observation.lane}`);
    byKey.set(key, observation);
  }
  const lane = (attack: AttackCase, name: "deterministic" | "live"): LaneCoverage => {
    const applicable = name === "deterministic" ? attack.gate !== "llm" : attack.gate !== "deterministic";
    if (!applicable) return { status: "NOT_APPLICABLE", evidence: [] };
    const observation = byKey.get(`${attack.id}\0${name}`);
    if (observation) return { status: observation.status, evidence: [...observation.evidence], ...(observation.limitation === undefined ? {} : { limitation: observation.limitation }) };
    return name === "live"
      ? { status: "BLOCKED", evidence: [], limitation: "No sealed holdout/live provider run with an effective-authority probe and explicit budget." }
      : { status: "NOT_RUN", evidence: [], limitation: "Actual Change Desk route and independent Medusa readback have not been executed for this case." };
  };
  const entries = cases.map((attack) => ({ id: attack.id, family: attack.family, surface: attack.surface, deterministic: lane(attack, "deterministic"), live: lane(attack, "live") }));
  const lanes = entries.flatMap(({ deterministic, live }) => [deterministic, live]).filter(({ status }) => status !== "NOT_APPLICABLE");
  return { schemaVersion: "1.0", corpus: "public-regression", isHoldout: false, cases: entries, summary: { publicCases: entries.length, applicableLanes: lanes.length, passedLanes: lanes.filter(({ status }) => status === "PASS").length, failedLanes: lanes.filter(({ status }) => status === "FAIL").length, blockedLanes: lanes.filter(({ status }) => status === "BLOCKED").length, notRunLanes: lanes.filter(({ status }) => status === "NOT_RUN").length } } as const;
}
