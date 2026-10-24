export interface CaseSelection { readonly reason: "classified-change" | "unknown-change-full-suite"; readonly caseIds: readonly string[] }

const RULES: readonly { readonly pattern: RegExp; readonly ids: readonly string[] }[] = [
  { pattern: /(?:renderer|\.tsx$|sdk-react)/i, ids: ["ATK-001", "ATK-011", "ATK-022", "ATK-023"] },
  { pattern: /(?:recipe\.schema|validation|parser)/i, ids: ["ATK-009", "ATK-010", "ATK-017", "ATK-020", "ATK-021"] },
  { pattern: /(?:policy|authorization|approval)/i, ids: ["ATK-002", "ATK-003", "ATK-004", "ATK-005", "ATK-008", "ATK-012", "ATK-015", "ATK-019", "ATK-020", "ATK-021", "ATK-023", "ATK-024"] },
  { pattern: /(?:adapter|medusa|execution|worker|reconcil)/i, ids: ["ATK-003", "ATK-008", "ATK-010", "ATK-015", "ATK-016", "ATK-019"] },
  { pattern: /(?:storage|database|migration|tenant)/i, ids: ["ATK-003", "ATK-007", "ATK-014", "ATK-018"] },
  { pattern: /(?:planner|provider|prompt|model)/i, ids: ["ATK-001", "ATK-002", "ATK-009", "ATK-010", "ATK-012", "ATK-014", "ATK-017", "ATK-022", "ATK-023"] },
  { pattern: /(?:session|ticket|bridge|csrf)/i, ids: ["ATK-002", "ATK-006", "ATK-007", "ATK-024"] },
  { pattern: /(?:publication|catalog|reuse|installation)/i, ids: ["ATK-012", "ATK-013", "ATK-014", "ATK-021"] },
];

export function selectCasesForChanges(paths: readonly string[], availableCaseIds: readonly string[]): CaseSelection {
  const available = new Set(availableCaseIds);
  const selected = new Set<string>();
  let unknown = paths.length === 0;
  for (const path of paths) {
    const matching = RULES.filter(({ pattern }) => pattern.test(path));
    if (matching.length === 0) unknown = true;
    for (const { ids } of matching) for (const id of ids) if (available.has(id)) selected.add(id);
  }
  if (unknown) return { reason: "unknown-change-full-suite", caseIds: [...availableCaseIds] };
  return { reason: "classified-change", caseIds: availableCaseIds.filter((id) => selected.has(id)) };
}
