import Base

# Boolean model for one product-association field. Category and channel each
# instantiate the same function independently. This does not model Medusa IO.
def association_add(existing: Bool, eligible: Bool, requested: Bool, approved: Bool) -> Bool:
  match existing:
    case True{}:
      True{}
    case False{}:
      eligible && requested && approved

def action_emitted(existing: Bool, eligible: Bool, requested: Bool, approved: Bool) -> Bool:
  match existing:
    case True{}:
      False{}
    case False{}:
      eligible && requested && approved
