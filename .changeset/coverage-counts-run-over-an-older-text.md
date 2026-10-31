---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

`variance coverage` leads each row with what ran over the checkout's text, and prints what ran in any text beside it: a region whose every test ran it before an edit that touched it counts over an older text, and one no suite says the text of counts as not known. `--format json` carries `over.this` beside `run`, and the markdown breakdown's rows no longer overlap. In CI the published source index is brought up to the checkout before its texts are named. The part shows on each suite row, the `--from` scope and each `--packages` row; a region whose run's text cannot be found counts as not known, with the reason named once. The heading names the commit the record was made at when it differs from the checkout. `countCoverage` takes the per-region verdict from its caller (`textOf`), and `regionTouched` reads whether a chain of edits touched a region by the rule the record carries its cases by. `variance covering --line`, `--lines` and `--function` no longer call a region changed by an edit that does not reach its code, such as a comment written inside a function.
