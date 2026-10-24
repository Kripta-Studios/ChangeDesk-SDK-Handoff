import Base

def association_add(existing: Bool, eligible: Bool, requested: Bool, approved: Bool) -> Bool:
  match existing:
    case True{}:
      True{}
    case False{}:
      eligible && requested && approved
