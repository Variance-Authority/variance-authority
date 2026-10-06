---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A record lets go of a test file the runner stopped collecting

A test file the suite no longer collects is one no run records again. It kept
its rows, its cases and its place in the runs record, standing at the commit it
last ran, and every selection read each file changed since that commit whole on
its behalf. A suite moved into a slice of its own left every file it took with
it standing in the suite it left.

The Vitest seam now asks the runner, as a run lands, whether each test file the
record holds and the run did not run is one it collects, through each project's
own `matchesTestGlob`. A file no project collects leaves the record
with its cases and its standing. A run narrowed on the command line — excluded
files, picked projects — has no answer and lets nothing go.

`variance journeys <shard.bin>...` takes `--collected <file>`, the runner's own
list of the test files it collects, one per line, as `vitest list --filesOnly`
prints them. A fold landed with it lets go of every test file the record holds
that the shards did not run and the list does not name. Without the list
nothing leaves.
