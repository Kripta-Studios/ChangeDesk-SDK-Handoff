import { describe, expect, it } from "vitest";
import { addAssociation, emittedAction, lawsHold, type AssociationInput } from "../../apps/service/src/laws/model.js";

const booleans = [false, true] as const;
const inputs = (): AssociationInput[] => {
  const values: AssociationInput[] = [];
  for (const existing of booleans)
    for (const eligible of booleans)
      for (const requested of booleans)
        for (const approved of booleans)
          values.push({ existing, eligible, requested, approved });
  return values;
};

describe("boolean association model", () => {
  it("exhaustively satisfies preservation, idempotence, exclusion and approved-scope laws", () => {
    for (const input of inputs()) expect(lawsHold(input)).toEqual({
      associationPreservesExisting: true,
      associationIdempotent: true,
      excludedUnchanged: true,
      actionsSubsetApproved: true,
    });
  });

  it("differentiates an intentionally destructive mutant", () => {
    const destructiveAdd = (input: AssociationInput): boolean => input.eligible && input.requested && input.approved;
    expect(destructiveAdd({ existing: true, eligible: false, requested: false, approved: false })).toBe(false);
    expect(addAssociation({ existing: true, eligible: false, requested: false, approved: false })).toBe(true);
  });

  it("emits no action outside approved scope", () => {
    expect(emittedAction({ existing: false, eligible: true, requested: true, approved: false })).toBe(false);
  });
});
