---
'@variance-authority/cli': patch
---

`ask discover` still refuses a pattern flag given twice — `--path`, `--declares`,
`--text`, `--except-path` or `--except-declares` — and the refusal now gives the
one value that matches either, ready to run:
`` `--path` was given more than once. It takes one regular expression; to match either, give `--path '(?:^packages/cli/)|(?:^packages/help/)'` ``.
