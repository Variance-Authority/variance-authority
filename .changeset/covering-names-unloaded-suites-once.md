---
"@variance-authority/cli": patch
---

`variance covering` across declared suites now prints the answers first, then
any suite with no recording yet, and names every suite that never loaded the
file on one closing line, `Not loaded by chromium (e2e): …`, instead of opening
with a paragraph per suite that carried the record's cache path and file count.
A suite whose record spells the file another way, which most likely ran it from
another root, keeps its full refusal among the answers. When no suite loaded the
file, each suite still explains in full, with the record it read and the nearest
spelling it holds. `--format refs` follows the text; `--format json` adds
`spelled` to an `unloaded` refusal whose record holds such spellings.
