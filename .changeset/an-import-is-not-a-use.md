---
'@variance-authority/distill': minor
'@variance-authority/sense': minor
---

An import is not a use

Distill read an entered file and nothing smaller. Any crossing anywhere in a
module made the file entered, at the shortest depth observed, and which region
had been crossed was dropped on the way out. That is the reading test selection
needs and it is built to over-answer: a module's initialization is attributed to
every test that consumed the module, so a change cannot skip a test.

Reduction asks the opposite question. `import { A } from './B'` runs `B`'s top
level and nothing else — a spy answers in `A`'s place, or the branch that would
have rendered it is never taken — and the module root is crossed either way. Run
through a conservative file-level index, a component nothing rendered came back
as source the test reached.

`EnteredModule` is the second reading of the same crossings, one region at a
time. `loadedOnly` marks a module whose every crossing is a consequence of
loading it; `unentered` names the declarations the test never reached, at the
outermost declaration that owns them. A module root has no caller a test could
be, so both are derived from the region's own kind and ask nothing new of a
producer. `ExecutionCrossing.loaded` is there for a producer that watched the
evaluation and can say the same about a region below the root — a function the
top level called — and that mark is believed over the kind.

`formatDistillation` names those modules and the substitution to try against
each. The substitution is a candidate: mocking takes the top level with the
rest, and a top level that registers a handler, installs a polyfill or builds a
singleton is one the test may be standing on. Make it, rerun the exact test,
compare the witness.

`parseExecutionIndex` also stops rejecting a module root. It required every
block name to be non-empty, and a module root is the one region with no
declaration to be named after — so no index carrying one could cross the CLI's
JSON boundary.
