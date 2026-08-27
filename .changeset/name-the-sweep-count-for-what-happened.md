---
'@variance-authority/tribunal': minor
---

Name the sweep count for what happened to it

`SweepReport.decisions` became `decisionsKept`. Every other number in that
report is a removal, and the README sentence beside it says the store "reports
counts for everything it removed" — so an operator reading `decisions: 4`
concludes four approvals were deleted, which is the one thing the `decisions`
table's permanence trigger exists to make impossible. The number was always the
opposite: approvals that outlived the builds this call removed.
