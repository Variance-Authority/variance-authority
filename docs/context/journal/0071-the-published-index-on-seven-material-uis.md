# The published index on seven Material UIs

**Date:** 2026-09-24

The source index had just become published state: `variance index` wrote it
and every graph reader read it without scanning. This entry measured what that
split cost and saved on the scale corpus. Measuring it turned up two defects,
and both were fixed before the numbers below were taken.

Machine: M4 Max, 64 GB, Node v26.7.0. Other sessions were running, and the load
average sat between 4.5 and 9.6, so every row is three processes and is printed
as min–max.

## The corpus

The corpus was seven copies of Material UI `8f19b1009b` in one checkout:
288,197 tracked paths, of which the scan answered 194,544. It is the corpus
`docs/agent-workspace-api.md` measures search on. An earlier session built it
by hand and recorded nothing about it. Before this entry, a five-copy variant
had been improvised in its place. So the recipe is now the `build` function of
`packages/sense/scripts/published-index.mjs`: `read-tree --prefix=copyN/` once
per copy, in a repository that borrows Material UI's objects through
`alternates`. The script also runs every row below.

## What it measured

| Operation | ms | Peak RSS MB | Files read again |
|---|---|---|---|
| publish, nothing published | 5,573–6,141 | 1,575–1,605 | 194,544 |
| publish, nothing moved | 3,192–3,530 | 1,211–1,223 | 7 |
| publish, 1 file edited | 3,122–3,644 | 1,209–1,263 | 8 |
| publish, 101 files edited | 3,216–3,606 | 1,217–1,263 | 107 |
| read the publish | 909–957 | 615–616 | — |
| scan as reader, no cache | 5,501–5,878 | 1,598–1,620 | — |
| scan as reader, cache warm | 2,343–2,487 | 921–935 | — |
| worktree, first publish, primary published | 3,505–3,930 | 985–1,022 | 8 |
| worktree, first publish, nothing published | 6,266–6,757 | 1,583–1,621 | 194,544 |

A reader went from 2.4 s and 0.93 GB to 0.93 s and 0.62 GB. The step did not
scale with the diff. One edit and a hundred and one edits each cost about as
much as no edit at all, about 3.3 s. That is more than a single warm reader
used to cost.

So the split paid for itself from the third reader in a pipeline. One reader
cost 4.2 s against 2.4 s before, and three cost 6.1 s against 7.2 s. The fixed
cost of an update that finds nothing moved was the next lever. It was not taken
apart here.

## Unknown records were not published

The first run held 194,537 files in the published generation and 194,544 in the
scan. The seven missing files were `copyN/packages/mui-icons-material/lib/index.js`,
one per copy, 2.3 MB each, over the 1 MB `largestFile` cap. The scan recorded
each of them as `unknown` with its size. Every record cache dropped a record
without a digest in `set`, and the oversize path built one with none, although
Git had already given it one.

So from the commit that introduced the published index onward, a reader did
not find those files at all. The scan it replaced had reported them as unknown.
That broke the rule that absent is not empty, at the size where it matters
most. The caches now hold every record and hand back only one whose digest
matches. A record with no digest is therefore published and rebuilt on each
update. That rebuild is a stat, and it is the seven "read again" in the
nothing-moved row.

## A worktree started from nothing

A worktree's first update read all 194,544 files. The index is keyed per
checkout, and the checkout's own was empty. The first fix copied the primary
checkout's generation in before the first update. It is a copy and not a
reference, because the owner compacts its chain and deletes the segments it
dropped. The segments were read through their digests and published under one
manifest commit.

The copy alone did nothing. On the fixture the worktree still read every file
again, because the record cache's configuration key included the absolute root.
The stored records carried none: a check over 1,356,790 stored strings found no
absolute path. The root was taken out of the key and the record version moved
to 4. After that, the worktree read the one file that differed plus the seven
unknowns, and its first publish cost 3.5–3.9 s instead of 6.3–6.8 s.

## What it did not settle

A reader answers from the last publish. A file added since then can change what
a specifier resolves to, and the reader does not know. That is the position
`variance index` states by being a step, and it was left as one.

The update's fixed cost was not attributed. The candidates were the tree
listing, the configuration digest, the walk over 194,544 held records, the
taint pass and the save.
