---
"@variance-authority/sense": minor
"@variance-authority/cli": minor
---

`variance coverage` counts apart what ran over an older text: a region whose every test ran it before an edit that touched it. The part shows on each suite row, the `--from` scope and each `--packages` row; a region whose run's text cannot be found counts as not known, with the reason named once. The heading names the commit the record was made at when it differs from the checkout. `countCoverage` takes the per-region verdict from its caller (`textOf`), and `regionTouched` reads whether a chain of edits touched a region by the rule the record carries its cases by.
