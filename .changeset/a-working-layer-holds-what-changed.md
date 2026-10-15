---
'@variance-authority/sense': patch
---

An update writes only the rows that changed into the source index

The source index is a base and a working layer over it, and a save rewrote the
working layer with every row it was handed. An update that read every file
again, as one does after a change to how imports resolve, handed it every row,
so the working layer held the whole repository a second time though almost none
of it had changed: on a repository of 450,000 files, 316 MB where 25 MB had
moved.

The working layer now leaves out a row the base already holds as it stands, so
it holds what changed since the index was readied.
