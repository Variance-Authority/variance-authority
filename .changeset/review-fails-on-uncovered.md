---
'@variance-authority/cli': minor
---

`variance review --fail-on-uncovered` exits `1` when a changed function holds
code no case ran, and `Variance-Authority/action/review` takes it as
`fail-on-uncovered`, posting the comment before the step fails, so a project can
require the check. It reads the count the review prints, with no percentage. It
exits `2` when the record does not hold the change, or when source changed and
nothing shows a run of it. A changed file a run of this change did not load is
named on stderr and not counted, whether its functions are new or edited.

The review comment now says "did" and "no case ran" for a change any suite of the
review ran as the tree holds it, where it said "might do" unless the named suite
had: a project whose named suite is stale reads the firmer wording, with or
without the flag.
