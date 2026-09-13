---
'@variance-authority/cli': minor
'@variance-authority/store': patch
---

`baselines.records` puts the sidecars where git is not looking

A baseline is an image and a record of how it was painted. The image moves when a
pixel moves; the record moves whenever the *document* does — a class name, a
build id, a font that resolved somewhere else — so a record committed beside its
image puts a tracked diff on every edit that moved nothing. At a few hundred
subjects the baseline directory is the noisiest path in the repository, and a
directory nobody reads is a directory that catches nothing.

`"records": ".variance/records"` on a `directory` or `lfs` baselines section sets
the store's `recordRoot`, and the rule it buys is worth stating plainly: if a
change did not update an image, it updates no file under version control.

Unlike `cacheRoot` beside it, this is not inferred. A lost cache entry costs a
render; a lost record costs the run its `missingFonts` and its `findingMarks`,
which are evidence a verdict is allowed to turn on — so where they go is your
decision and the config is where you make it.

It moves the record's directory and nothing else. Both halves are still written
and both are still read, so half a pair still stops the run and still names the
file it looked for, in whichever root it looked in. A repository that leaves
`baselines.records` unset keeps `*.json merge=binary` as the stopgap it was.
