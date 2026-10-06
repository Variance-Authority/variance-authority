---
"@variance-authority/core": minor
"@variance-authority/distill": minor
"@variance-authority/cli": minor
---

`variance distill --file <path>` lists each module no case entered under the
import that made the test file load it: the topmost import every path from the
test file to the module runs through, with nothing behind it that a case
entered, often in a module the test used rather than in the test file. A module
two imports reach is listed as shared, with the nearest file every path to it
runs through; one no static import reaches, such as a dynamic import's, is
listed apart. The file graph is read from the checkout only when the reading
has a module no case entered. A module the file mocked with a factory was never
evaluated, and its import is not walked.

`@variance-authority/core/relate` exports `dominatorsOf`, each node's immediate
dominator from a root. `distillFile` takes an optional `imports` lookup and
sets `cause` on each module no case entered; `@variance-authority/distill`
exports `LoadCause`.
