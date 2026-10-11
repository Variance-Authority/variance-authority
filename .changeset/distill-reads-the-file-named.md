---
'@variance-authority/cli': minor
'@variance-authority/distill': minor
---

`variance distill --file <path>` reads the test file the path names, and no other

`--file` takes the test file's path, relative to the checkout or absolute, and
reads it as the record spells it: repository-relative, with `/`. A recorded
path that contains the one you gave, or ends in it, is another file, so
`--file test/dialog.test.ts` is refused when the record holds only
`test/dialog.test.tsx`, and so is `--file dialog`. The refusal names no
other path, and says the record names each test file from the repository root. A path outside
the checkout is refused as outside it. The same holds when `--file` narrows
`--test`. From Node, `distillFile` and `distill` take `file` as the
repository-relative path and match it exactly.
