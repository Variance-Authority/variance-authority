# ADR-0086 — An LFS checkout fetches what it compares

**Status:** accepted
**Date:** 2026-10-08
**Amends:** [ADR-0016](0016-where-a-baseline-is-kept-decides-nothing.md)
(§"Nothing shells out to git to read or write an image")
**Relates to:** [spec 0018](../../specs/0018-git-lfs-proven-as-git-lfs.md),
[`packages/store/src/lfs-fetch.ts`](../../../packages/store/src/lfs-fetch.ts)

## Context

ADR-0016 kept git out of the image path: LFS is a clean/smudge filter, so a
smudged checkout already holds every PNG, and the store reads files. A checkout
that was not smudged holds pointers, and the store refused the first one it met.

So a CI job on the `lfs` placement had to smudge, and a smudge downloads every
baseline in the repository on every run. Most of a run never reads one: the
sidecars are text outside the tracked glob, and `describe` settles every subject
whose document did not move from its sidecar. The images a run reads are the
baselines of the subjects that changed. The download did not scale with them; it
scaled with the suite.

## Decision

**When `find` reads a pointer, the LFS store runs `git lfs pull --include=<that
file>`, then reads the file again.** A job checks out with
`GIT_LFS_SKIP_SMUDGE=1`, or `lfs: false` on `actions/checkout`, runs `git lfs
install --local --skip-smudge`, and downloads the images of the subjects it
compares. Without that install git-lfs is on the machine but git never runs it:
a pull skips the checkout and a commit stores the whole image. The store
reports the unset `filter.lfs.clean` at open, and refuses a pointer the pull
left in place, naming the install.

- **One pull at a time.** The first pointer starts a pull. Every pointer met
  while it runs joins the next pull, which starts when it finishes. There is no
  timer.
- **The durable store still owns the path.** It takes a `readImage` reader,
  and the LFS store passes one that fetches. Nothing outside `placement.ts`
  computes where a baseline lives.
- **A failed fetch is a refusal.** If git-lfs is missing, the pull exits
  non-zero, or the work tree cannot be found, the lookup throws a
  `RasterStoreError`, exit 2. It never reports a missing baseline: `new` would
  re-record over the image nobody could download.
- **`verify: false` fetches nothing.** It keeps git out of the store entirely,
  as before, and a pointer is refused.
- **`describe` and the render cache never fetch.** `describe` reads sidecars.
  A cached render that is a pointer is a miss, and a render is cheaper than a
  download that might fail.

ADR-0016's reason for the rule stands: the store never has two sources for the
same bytes. git-lfs writes the file, and the store reads the file, as it did.
What changes is that git now runs in the read path, for a pointer only.

## Alternatives

- **Smudge in the job (the old recipe).** It is correct, and the download is
  the size of the suite. It stays available: a smudged checkout never meets a
  pointer, so the store never runs git.
- **`git lfs pull` of the whole root at open.** The same download as a smudge,
  one step later.
- **Ask for the working set in `expect`.** The remote store uses `expect` to
  prefetch. Here the working set is the subjects whose documents moved, which
  is known only after `describe`, inside each lane. A list built before the
  lanes run would be every subject.
- **Cache `.git/lfs/objects` between runs.** No code, and the usual answer to
  LFS bandwidth on GitHub. The first run on a runner, and every run after the
  cache is evicted, still downloads the suite, and a cache is a CI service's
  feature where this works wherever git does. The two compose: a cached object
  makes the pull local.
- **The remote renderer's `batching`.** It coalesces overlapping calls too,
  but flushes on the next turn of the event loop and lets batches run side by
  side, and answers per item. Pulls in one work tree contend for its index, so
  here only one runs at a time, and one pull either fetched its files or did
  not. It also lives in `remote`, which `store` does not depend on.
- **`git lfs smudge` per file, writing the bytes ourselves.** That is a second
  writer for the work tree, and `git status` would then report the file as
  modified. `git lfs pull` checks the file out the way the filter would.

## Consequences

- An `lfs` job's download grows with the subjects that changed, not with the
  suite.
- An unsmudged checkout on a machine without git-lfs now fails with git-lfs's
  own error ("'lfs' is not a git command") inside the refusal, not with a
  generic pointer message.
- Batching is per process. Playwright workers each pull for themselves, and
  pulls that overlap contend for the index: each pull checks its file out and
  exits 0, and `git status` lists those files as modified until git rereads
  them. `git add` stores the same pointers, so nothing is committed by it.
- A pull has no timeout, like every other git call in the store, so a hung LFS
  server hangs the lookup that waits on it. ADR-0016 kept network calls out of
  the path that decides a verdict for this reason; a pointer is the one case
  that now has one, and the job's own timeout is what ends it.
- Each pull is a process and a round trip to the LFS server. A run where every
  subject changed makes a few large pulls rather than one, which costs more
  than one smudge would have.
