---
'@variance-authority/sense': patch
---

`variance select` reads each importer once per selection

A changed file with no instrumented row is answered by the nearest files that
import it, and a file many changed files reach was read again for each of them:
two binary searches over the record's paths, each decoding a path at every
step, then the crossings of its rows. It is read once, and every changed file
that reaches it gets that answer under its own trail. The mocks a selection
checks are read once per selection rather than once for the rows and again for
the walk, and a test's path is decoded once per test rather than once per
crossing.
