import { describe, expect, it } from "vitest";
import { selectCasesForChanges } from "../../apps/service/src/evals/change-impact.js";

const ids = Array.from({ length: 24 }, (_, i) => `ATK-${String(i + 1).padStart(3, "0")}`);
describe("ACC-013 change-directed attack selection", () => {
  it("falls back to the complete public suite for an unclassified change", () => {
    const result = selectCasesForChanges(["apps/service/src/new-boundary/opaque.ts"], ids);
    expect(result).toEqual({ reason: "unknown-change-full-suite", caseIds: ids });
  });
  it("selects UI and approval deception cases for renderer changes", () => {
    const result = selectCasesForChanges(["packages/sdk-react/src/plan-renderer.tsx"], ids);
    expect(result.reason).toBe("classified-change");
    expect(result.caseIds).toEqual(expect.arrayContaining(["ATK-011", "ATK-023"]));
    expect(result.caseIds.length).toBeLessThan(ids.length);
  });
});
