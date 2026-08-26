# ADR-0053 — Product meaning names the relationship

**Status:** accepted
**Date:** 2026-08-26
**Extends:** ADR-0050 (presentation relationships are evidence, not design
policy), ADR-0051 (presentation evidence has a structural owner)

## Context

Computed spacing proves where rendered boxes landed. A design-system token can
explain which implementation value contributed to that result. Neither says
whether the relation is an owner boundary, a heading binding to its body, two
body peers, or content inside one body block.

Treating token validity as relationship authority launders a local defect
through the design system. Repetition makes that failure more systematic without
making it more correct. Automatic inference has the inverse limit: it can expose
strong recurring shapes but cannot invent product meaning for an unseen
composition.

## Decision

**Product-owned hierarchy contracts name spacing relationship roles outside-in;
tokens remain implementation evidence and cannot authorize a role.**

`PresentationHierarchyContract` contains one structural owner, one axis and at
least two ordered relationship levels. The public roles are `owner-boundary`,
`leading-to-body`, `body-peer` and `content-internal`. Each level names concrete
separation pairs from an existing presentation report.

`inspectPresentationHierarchy` refuses unknown owners or nodes, relationships
outside the owner, missing measured separations, duplicate roles, reversed
roles, reused pairs and incompatible axes. It compares adjacent declared levels.
A shared spacing cluster or calibrated local distribution becomes measured
`SPACING_HIERARCHY_COLLISION` evidence with both role names, medians and ratio.
The reading and its paint retain the contract id. Painting labels every declared
edge and reuses the report without another acquisition.

The contract chooses no spacing value and is not accepted merely because its
role names typecheck. The product-aware caller remains responsible for the
owner, peers and roles it declares.

## Consequences

A component test or coding agent can state the relationship it means without
promoting a design token into an oracle. The type and runtime checks make the
outside-in vocabulary and ownership boundary visible at the call site. Equal
values remain legal where the caller has not declared distinct adjacent roles.

Automatic findings remain useful for recurring structures. Explicit contracts
cover product-known relationships automatic inference cannot license, and a
clean automatic report is no longer a reason to stop before checking the mapped
hierarchy.
