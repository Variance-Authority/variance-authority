---
"@variance-authority/cli": patch
---

`variance covering` across declared suites now prints the answers first, then
any suite with no recording yet, and names every suite that never loaded the
file on one closing line, `Not loaded by chromium (e2e): …`, instead of opening
with a paragraph per suite that carried the record's cache path and file count.
A suite whose record holds the path under another root, which most likely ran
the file, keeps its full refusal among the answers. When no suite answers, each
still explains in full, with the record it read and the recorded files of the
same name. `--format refs` follows the text; `--format json` adds `spelled`, the
recorded paths under another root, to an `unloaded` refusal that has any.
