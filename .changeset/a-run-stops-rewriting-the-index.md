---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
'@variance-authority/distill': minor
'@variance-authority/mcp': minor
'@variance-authority/storybook-collector': minor
'@variance-authority/playwright-test': minor
---

A run that changed ten files stops rewriting the whole selection index

Every run after the first reads the selection index, lays its own recording over
it, and writes it back. At a repository's scale almost all of that was spent
making objects nobody reads: a run that re-records ten modules of twenty thousand
decoded six hundred thousand regions into a model, merged ten of them, and
encoded the model back — the other 99.95% of the index materialized and
re-serialized to arrive at the bytes it was read from.

`layerTestCoverage` does the merge and the encode as one pass over the columns
the previous snapshot is already stored in. A module the run did not touch is
never made an object: its rows are copied column to column as integers, its
strings blob to blob as bytes, and the only thing that happens to either is the
renumbering the new dictionary implies. Objects are made for what the merge has
to reason about — the tests, the modules this run re-recorded, and the carried
modules whose text moved on disk. Over twenty thousand modules that is 1855 ms to
616, and it is byte for byte the same file, which a gate asserts across every
case the merge distinguishes.

The columns are now zstd rather than brotli, at two levels, because the runs are
two kinds of data. A varint run is a dense stream of small integers and answers
to a long search; a run of the string blob is file paths and hex digests, which
zstd finds most of at level 1 and nothing more of above it. Against the brotli
quality 4 it replaces, over the same snapshot: 319 ms to compress became 120, and
the file got 86 KB smaller.

`zlib.zstdCompressSync` arrived in Node 22.15, so that is the floor these
packages declare. The snapshot's layout version moved with the codec, which means
an index written by an earlier build is refused at its header and rebuilt — one
full run, and nothing a reader has to think about.
