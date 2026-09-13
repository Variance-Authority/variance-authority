---
'@variance-authority/sense': patch
---

A run that instrumented nothing says so

A vitest project inherits neither plugins nor setup files from the configuration
around it, so the wrap that looks right — one at the root, projects beneath it —
transforms no product module. Nothing fails: the suite runs, the reporter runs,
the snapshot is written. It says every test reaches no source,
`narrowByExecution` reads that as an answer, and every selection made from it
narrows to the empty set. The first sign is a green pipeline that stopped
testing.

The reporter warns on the one state that is indistinguishable from a clean run
and is not one: zero modules instrumented across one or more test files. Said
rather than thrown, because zero is legitimate — a run filtered to a single test
file that imports no source has nothing to instrument — and the message names the
two misconfigurations it usually is, since "0 modules" on its own does not say
which. Zero test files is left alone; the runner has already said that.

Wrap each project, and keep one wrap at the root for the reporter that folds the
run. The README carries the shape.
