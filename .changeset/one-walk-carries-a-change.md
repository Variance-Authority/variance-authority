---
'@variance-authority/core': minor
'@variance-authority/sense': patch
---

One walk carries a change to every file that loads it

`@variance-authority/core/relate` exports `carried`, the walk against the
arrows that `dependentsOf`, its narrowed form and test selection's two importer
walks now all run. You pass seeds, each with what its change carries — the
whole file, or the names that moved — and a step that says what one importer
does with what reached it. The walk owns the worklist, enters each file once
per name, ends on any cycle, and treats a step with no answer as the whole
file. A walk you write over the graph gets the same answers on cycles,
self-imports and re-exports as the ones the selector runs, with no loop of your
own.
