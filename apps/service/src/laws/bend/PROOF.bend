import Base
import ./LAWS.bend as Laws

def Laws.association_preserves_existing(eligible, requested, approved):
  {==}

def Laws.association_idempotent(existing, eligible, requested, approved):
  match existing eligible requested approved:
    case True{} _ _ _:
      {==}
    case False{} False{} _ _:
      {==}
    case False{} True{} False{} _:
      {==}
    case False{} True{} True{} False{}:
      {==}
    case False{} True{} True{} True{}:
      {==}

def Laws.excluded_unchanged(existing, requested, approved):
  match existing:
    case True{}:
      {==}
    case False{}:
      {==}

def Laws.actions_subset_approved(existing, eligible, requested):
  match existing eligible requested:
    case True{} _ _:
      {==}
    case False{} False{} _:
      {==}
    case False{} True{} False{}:
      {==}
    case False{} True{} True{}:
      {==}
