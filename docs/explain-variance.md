# Explain variance

A difference becomes useful when you can locate it, understand the conditions
around it, and bring it to the team best placed to respond. The tools here help
build that explanation while leaving approval and product judgment with their
existing owners.

## Ask what kind of explanation is missing

| Question | Route |
| --- | --- |
| Which element, component, and source location own a visible region? | [Attribute the change](attribution.md) |
| Where did two readings begin to diverge? | [Find where they part](parting.md) |
| Is the variance unstable, and who can remove its cause? | [Classify flakiness](flakiness.md) |
| What must be held still before the subject is read? | [Stabilize acquisition](stabilization.md) |
| Do several subjects express one cause? | [Compose repeated evidence](composition.md) |
| Are these subjects intentional forms of one state? | [Declare variations](variations.md) |
| Which observed changes matter to this decision? | [Set sensitivity](sensitivity.md) |
| Which place or shape is intentionally outside the decision? | [Define an ignore](ignores.md) |

These are not stages. A source-attributed region may need no flake analysis. An
unstable execution may need no baseline. A variation can explain a difference
without authorizing it.

## Preserve the chain of evidence

[Attribution](attribution.md) runs from source to semantics to raster; it does not infer source
from a coincident pixel. Parting compares witnessed inputs and states at the
point they diverge. [Composition](composition.md) groups evidence on stable causes rather than
visual proximity. Flakiness connects each known source of variance to the tool,
environment, or decision that can address it, and keeps the unresolved
remainder visible.

Each explanation keeps the evidence that earned it and names the hop it could
not complete.

## Explanation informs the decision

A cause can be known and still require review. A difference can be intentional
without matching an existing rule. A stable result can still be wrong for the
product.

Rules, approvals, and the consuming workflow decide what may happen next. When
[provenance](attribution.md), comparability, or an observation band is missing, the explanation
stops there rather than borrowing confidence from the evidence beside it.
