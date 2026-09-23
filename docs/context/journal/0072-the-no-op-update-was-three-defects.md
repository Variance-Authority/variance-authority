# The no-op update was three defects

**Date:** 2026-09-24

Journal 0071 left the fixed cost of `variance index` unattributed: an update
that found nothing moved cost about as much as one that found a hundred edits.
This entry took it apart on the same corpus, seven copies of Material UI
`8f19b1009b` with 288,197 tracked paths, with `core.fsmonitor` and
`core.untrackedCache` set in the corpus's own configuration.

Machine: M4 Max, 64 GB, Node v26.7.0. The load average moved between 2.9 and 7
from other sessions, so every figure is a range over three processes.

## Where 2.8 seconds went

A CPU profile of the nothing-moved update, before any change:

| Part | ms |
|---|---|
| decode the published chain | 1,150 |
| the native tree snapshot | 720 |
| the scan's walk over held records | 450 |
| `shapeOf`, the directory digests | 110 |
| taint | 55 |

The whole process cost 2,750–2,900 ms. None of the parts was the work the
update exists for. Each of the three largest held a defect.

## The chain was decoded twice

`updateSourceIndex` opened the index once to read its state and again to update
it, and an open decodes every segment: about 580 ms each. The state is now read
off the one open, and a second open happens only when a worktree was seeded
from the primary checkout's index. Peak RSS fell from 1.19 GB to about 0.95 GB.

## The status call defeated the cache it was told to use

The snapshot asked git `status --untracked-files=all -- .`. The untracked cache
answers only `--untracked-files=normal` with no pathspec, and either difference
alone makes git walk every directory. On the corpus the call cost 370 ms, and
40 ms in the shape the cache answers. With the cache off, the two shapes cost
the same.

At the top of a checkout the snapshot now asks the answerable shape. That shape
reports a new directory as the directory, so every directory it collapses is
listed with `git ls-files --others --exclude-standard`, which applies the same
ignore rules. The native snapshot had a second defect here: a collapsed path in
the batch made `hash-object` fail, and the whole batch was dropped. A new test
in `packages/sense/src/native.test.ts` covers the collapsed directory, a nested
repository and an ignored file. Against the old addon it found 10 paths where
the oracle found 13. Below the top of a checkout the old call stays: a
subdirectory status cost about 40 ms either way.

`docs/performance.md` had said the cache "does not move this row" because the
figures came from a clean checkout. The reason was the call shape. On a 41,171-path
clone of Material UI the three configurations now cost 98, 56 and 17 ms, against
97, 57 and 55 ms in the old shape.

## The listing was sorted twice

The native snapshot put `ls-tree` output into a hash map, overlaid the status,
and sorted the result by code unit. `ls-tree` already prints in byte order over
the whole path, and byte order and code-unit order differ only past U+E000. The
listing now stays a vector in the order git printed it. The overlay filters it
and merges its own sorted additions in. The final order is checked, and sorted
only when a path past U+E000 broke it. `gitTree` went from 270 to 150 ms and
`gitTreeFor` from 300 to 170 ms.

## What it came to

| Update, nothing moved | ms | Peak RSS MB |
|---|---|---|
| before | 2,750–2,900 | 1,190 |
| after | 1,449–1,557 | 931–966 |

## What it did not settle

What remains is a walk over 194,544 held records to confirm that each one's digest
and shape still match. Its floor, measured as the tree, the fold over its
digests and the shape without the decode, was about 640 ms whole process. An
update could reach it by recording one identity for its whole input when it
publishes. That identity would fold every path and digest, the configuration and
the options. When the identity is unchanged, the decode, the walk, the taint and
the save are skipped. That changes the published manifest, so it was not built
here. The seven oversize records that are read again on every update would stop
being read too.
