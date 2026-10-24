import Base
import ./model.bend as Model

# Existing category/channel membership is never removed by an additive step.
law association_preserves_existing:
  for eligible: Bool
  for requested: Bool
  for approved: Bool
  {Model.association_add(True{}, eligible, requested, approved) == True{} : Bool}

# Reapplying the same authorized additive step has the same final membership.
law association_idempotent:
  for existing: Bool
  for eligible: Bool
  for requested: Bool
  for approved: Bool
  once = Model.association_add(existing, eligible, requested, approved)
  {Model.association_add(once, eligible, requested, approved) == once : Bool}

# A record excluded by eligibility remains unchanged.
law excluded_unchanged:
  for existing: Bool
  for requested: Bool
  for approved: Bool
  {Model.association_add(existing, False{}, requested, approved) == existing : Bool}

# An emitted action is impossible when its matching approved-scope bit is false.
law actions_subset_approved:
  for existing: Bool
  for eligible: Bool
  for requested: Bool
  {Model.action_emitted(existing, eligible, requested, False{}) == False{} : Bool}
