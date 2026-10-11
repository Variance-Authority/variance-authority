---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`review` no longer reads a suite's cases at lines the change moved

A run that skips every test file it selected keeps no case. Its record then
holds its coverage rows re-cut to the tree's lines, and its case index carried
at the lines of the text before. `review` took such a suite as having run the
changed file as the tree holds it. With `--coverage` it listed each region a
second time, at its old lines and as run by no case, beside the same region at
its current lines with the cases that entered it. The warning, the "Where no
case ran" section and the graph all named the old lines.

A suite's cases are now read as the tree's only where its case index stands at
the lines of its coverage rows, as well as at the tree's text. The same rule
decides whether the review of the suite named with `--suite` says what the
change did or what it might do: when that suite's index was carried past its
rows, the review says what the change might do, and notes that the record was
made before the change. With `--coverage`, a suite whose index was carried gives
way to the suites that ran the file, and answers alone only where none did.
