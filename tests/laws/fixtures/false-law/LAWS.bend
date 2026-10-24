import Base
import ./model.bend as Model

# Deliberately false: adding an approved eligible association is not False.
law false_addition:
  {Model.association_add(False{}, True{}, True{}, True{}) == False{} : Bool}
