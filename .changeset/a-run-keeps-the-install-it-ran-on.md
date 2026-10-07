---
'@variance-authority/sense': patch
---

A recorded run keeps the install it ran on

When a run lands, the lockfiles and `package.json` files that differ from its
commit are kept beside the module texts a run already keeps, and
`coverage.runs.json` names them under `installed`, `{}` when the run ran on the
commit's own install. Runs at one commit over two different installs name none,
and neither does a recording made before this field existed: nothing is assumed
about an install no run recorded. `standsAt` hands the install to the selection
when every test it reads at the journal's commit ran in those runs.
