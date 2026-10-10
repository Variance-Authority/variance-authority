---
'@variance-authority/tribunal': minor
---

The rail opens with the work a build still asks for

A build's header said how many renders awaited a decision and how many
concerns stood, and neither number led anywhere. Finding the renders with an
open concern meant reading every row of the rail. The rail now opens with four tasks:
**Unreviewed**, **Open**, **Investigating** and **Resolved**. Each counts the
renders it covers — *Unreviewed* what the header's *awaiting review* counts — and choosing one narrows the rail and the bar's
<kbd>J</kbd> and <kbd>K</kbd> to them; the render on screen keeps its place
until you move on, even once deciding it takes it out of the task. The header
now reads `concerns: 2 open · …`, since it counts concerns and the tasks
count renders. The bar's *Flag as investigating* is now *Investigate*, the
word the concern's own button uses. The address keeps the task, as
`?task=open`. A concern task also lists renders the build left unchanged,
when an earlier build's concern still stands on them. When concerns could not
be read, those tasks show `?` and say why, not zero.
