---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

The first run laid over a record that crossed a checkout — a seeded worktree, a
mainline record fetched in CI, a shared one — names the commit that record's
coverage stands at as the commit of the cases it replaced. A crossed record keeps
its cases and drops the run that wrote them, so that commit used to go unnamed,
and `variance review` and `covering --cases last` after the CI record job folded
its shards over the mainline's record had no commit to diff the replaced cases
from.
