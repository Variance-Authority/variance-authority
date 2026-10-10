---
"@variance-authority/cli": patch
---

`variance covering` across declared suites now prints the answers first and
names every suite that never loaded the file on one closing line, `Not loaded
by chromium (e2e): …`, instead of opening with a paragraph per suite that
carried the record's cache path and file count. When no suite loaded the file,
each suite still explains in full, with the record it read and the nearest
spelling it holds. `--format refs` follows the text; `--format json` is
unchanged.
