export interface AssociationInput {
  readonly existing: boolean;
  readonly eligible: boolean;
  readonly requested: boolean;
  readonly approved: boolean;
}

export function addAssociation(input: AssociationInput): boolean {
  return input.existing || (input.eligible && input.requested && input.approved);
}

export function emittedAction(input: AssociationInput): boolean {
  return !input.existing && input.eligible && input.requested && input.approved;
}

export function lawsHold(input: AssociationInput): {
  readonly associationPreservesExisting: boolean;
  readonly associationIdempotent: boolean;
  readonly excludedUnchanged: boolean;
  readonly actionsSubsetApproved: boolean;
} {
  const once = addAssociation(input);
  const twice = addAssociation({ ...input, existing: once });
  return {
    associationPreservesExisting: !input.existing || once,
    associationIdempotent: once === twice,
    excludedUnchanged: input.eligible || once === input.existing,
    actionsSubsetApproved: !emittedAction(input) || input.approved,
  };
}
