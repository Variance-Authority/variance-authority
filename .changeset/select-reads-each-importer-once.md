---
'@variance-authority/sense': patch
---

`variance select` reads each importer once per selection

A changed file with no instrumented row is answered by the nearest files that
import it, and a file many changed files reach was read again for each of them:
two binary searches over the record's paths, each decoding a path at every
step, then the crossings of its rows. It is now read once, and every changed
file that reaches it gets that answer under its own trail. A test's path is
decoded once per selection, not once per crossing a mock could disown.

On the variance-authority repository's own unit record, a selection decoded
440,798 paths for 6,678 distinct ones; it now decodes 84,767, and the CPU spent
reading the record's columns drops from 227 ms to 85 ms. What `select` prints is
unchanged.
