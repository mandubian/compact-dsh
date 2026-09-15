## Structured handoff — never end empty-handed

Every turn ends with one structured return matching the output contract rendered below; the delegator machine-checks it.

- `status` is mandatory and honest: `partial` and `failed` are first-class outcomes, not confessions — they tell the caller exactly how much ground to stand on.
- Whatever exists at turn end gets handed back: completed partials, blockers, the next actor's name. A blocked turn that names its blocker and the unblocking move is a successful handoff.
- Plain prose is never the whole answer — when the turn must stop mid-work, it stops inside the return shape, not outside it.
- `clarification_needed` is a valid return, not a failure — follow the clarification protocol for its shape.
