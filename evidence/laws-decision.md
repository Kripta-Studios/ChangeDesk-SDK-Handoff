# T11 normative law decision

Approved by the coordinator on 2026-10-24. Scope: the pure boolean model of one additive association field. Category and channel instantiate the same model independently. This is not a proof of authentication, Medusa reads/writes, transport, tenant isolation, or absence of prompt injection.

The reviewed laws are fixed as follows:

1. `association_preserves_existing`: an association that existed before the step remains present.
2. `association_idempotent`: applying the same eligible, requested and approved additive step twice has the same final membership as applying it once.
3. `excluded_unchanged`: a record with `eligible = false` retains its prior membership.
4. `actions_subset_approved`: no action is emitted when the matching approved-scope bit is false.

The normative statements live in `apps/service/src/laws/bend/LAWS.bend`. The TypeScript model and exhaustive property test are differential evidence only; they cannot replace the Bend kernel verdict. Changing a law, model, proof, Bend version, binary, policy binding or applicable artifact invalidates cached evidence.

Bend is pinned to v2.0.39, commit `a3efe8a3801f423827424227172eed9802c5e6cb`, Apache-2.0. The official Linux x64 archive SHA-256 is `6cf462fd8f70b094a4950ebb709a9c4ffd8f1d1189d9cedf1fd63cd5d041c7ab`; the extracted binary SHA-256 is `2ec160fa4486d33aff51e9eedcc294d6b531dc10c279c00b0c00685dae2045cd`.
