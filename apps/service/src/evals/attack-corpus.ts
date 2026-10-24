export type AttackGate = "deterministic" | "llm" | "both";

export interface AttackCase {
  readonly id: string;
  readonly family: string;
  readonly surface: string;
  readonly legitimateTask: string;
  readonly manipulation: string;
  readonly expected: string;
  readonly invariants: readonly string[];
  readonly gate: AttackGate;
  readonly split: "public-regression";
  readonly syntheticOnly: true;
  readonly cleanPairRequired: true;
  readonly oracle: string;
}

export interface AttackCorpus {
  readonly schemaVersion: string;
  readonly status: string;
  readonly cases: readonly AttackCase[];
  readonly isHoldout: false;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`attack case ${key} must be non-empty text`);
  return value;
};

export function parseAttackCorpus(input: unknown): AttackCorpus {
  if (!isRecord(input) || !Array.isArray(input.cases)) throw new TypeError("attack corpus must contain cases");
  const seen = new Set<string>();
  const cases = input.cases.map((candidate, index): AttackCase => {
    if (!isRecord(candidate)) throw new TypeError(`attack case ${index} must be an object`);
    const id = text(candidate, "id");
    if (!/^ATK-\d{3}$/.test(id) || seen.has(id)) throw new TypeError(`attack case id invalid or duplicated: ${id}`);
    seen.add(id);
    const gate = candidate.gate;
    if (gate !== "deterministic" && gate !== "llm" && gate !== "both") throw new TypeError(`${id} gate is invalid`);
    if (candidate.split !== "public-regression") throw new TypeError(`${id} is not public regression data`);
    if (candidate.syntheticOnly !== true || candidate.cleanPairRequired !== true) throw new TypeError(`${id} must remain synthetic and paired`);
    if (!Array.isArray(candidate.invariants) || candidate.invariants.length === 0 || candidate.invariants.some((value) => typeof value !== "string" || !value.startsWith("SEC-"))) throw new TypeError(`${id} invariants are invalid`);
    const oracle = text(candidate, "oracle");
    if (!/independent host state/i.test(oracle) || /model self-report/i.test(oracle) && !/never model self-report/i.test(oracle)) throw new TypeError(`${id} oracle is not independent`);
    return Object.freeze({ id, family: text(candidate, "family"), surface: text(candidate, "surface"), legitimateTask: text(candidate, "legitimateTask"), manipulation: text(candidate, "manipulation"), expected: text(candidate, "expected"), invariants: Object.freeze([...candidate.invariants] as string[]), gate, split: "public-regression", syntheticOnly: true, cleanPairRequired: true, oracle });
  });
  return Object.freeze({ schemaVersion: text(input, "schemaVersion"), status: text(input, "status"), cases: Object.freeze(cases), isHoldout: false });
}
