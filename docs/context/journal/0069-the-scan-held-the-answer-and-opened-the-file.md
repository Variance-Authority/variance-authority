# The scan held the answer and opened the file anyway

**Date:** 2026-09-21

Sense already taps git for both halves of what it knows. `ls-tree` and `status`
say which paths exist and which moved; six persistent `cat-file --batch` streams
hand back the bytes of every tracked one. The question that started this was
whether a truly direct reader — `.git/index` parsed here, packfiles mmapped here,
no subprocess — would be worth building.

It would not, and finding that out turned up two places where the answer git
already gives was being thrown away.

## `scan_graph` opened every file it had the object name for

[`scan_batch`](../../../packages/sense/native/src/batch.rs) reads through the
pack when it is handed object names. `scan_graph_with_tree` computes the same
object names — one per file in every wave of the closure walk — uses them to
spell an identity string, and then calls `read_all`, which opens all of them off
the disk.

Which path a cold scan takes is decided in
[`scan.ts`](../../../packages/sense/src/scan.ts):

```ts
const useGraph = !nativeGraphUsed && tree?.native !== undefined && pending.length >= 10_000;
```

The graph is selected at ten thousand pending files, so the path without the pack
reader was the path every large cold scan took. `scan_batch` had the pack and no
open/parse overlap; `scan_graph` had the overlap and no pack.

Pointing it at `read_git`, on Material UI at `8f19b1009b`, `packages` and
`docs/src`, three interleaved rounds:

```text
                 scan      process user   process sys
disk            582 ms         4.54 s        5.46 s
pack            473 ms         3.73 s        3.25 s
```

Spread within a round was under 8 ms either side. The wall clock moves 1.23x and
the kernel half falls forty percent, which is the shape
[journal 0059](0059-ripgrep-stops-exactly-where-we-do.md) predicts: what a
worktree read costs is the descriptor, and a blob read has no descriptor. One
`cat-file` process opens the packfile once; every object after that is a seek and
an inflate, with no path walk and no vnode lock shared with five other readers.

A process is not free, and the closure walk's later waves are tens of files
rather than thousands. Starting one costs 7.08 ms here; a blob saves about 53 µs
against an open, so a bucket earns its process at about 134 files.
`FILES_PER_PROCESS = 160` in
[`acquire.rs`](../../../packages/sense/native/src/acquire.rs) rounds that up, and
a wave below it reads from disk.

Nothing changes for dirty or untracked files. `git.rs` hashes those with
`hash-object`, which does not write the object, so `cat-file` answers `missing`
and `read_blob` drops to `open_and_parse` — the fallback every failure path
already used.

## The benchmark's control row was in the shipped path

Every `status` call sense makes passed `core.fsmonitor=false`. That string exists
in exactly one other place in the repository:

```js
const off = ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'];
```

— the control row of `scripts/source-index.mjs`, which disables both accelerators
in order to price them. It reached production in `84d63177` inside the same hunk
that added `status.relativePaths=true` and `-- .`, a change about scoping status
to a subdirectory. No comment, no journal, no test.

Meanwhile `docs/performance.md` tells readers to run
`git config core.fsmonitor true` and reports the 84 ms status becoming 45. Both
halves were honest and the two could not meet.

On the same Material UI checkout, clean, best of five:

```text
both off (what sense did)       111 ms
fsmonitor                        77 ms
fsmonitor and untrackedCache     79 ms
```

The override is gone from `tree.ts` and `git.rs`, and nothing replaces it. Not
`true` either: starting a file-system daemon on somebody's repository is not this
scanner's decision. The repository's own configuration decides, which is what the
documented two lines were always for. The untracked cache costs nothing here
because the checkout is clean — it pays on a working tree with build output in
it, which is every real one.

## What the direct reader would have been worth

Measured on a synthetic 200,000-file repository and falsified against a 20,000-
file incompressible one, so that delta compression was not doing the work:
`cat-file --batch` reads 200k blobs in 0.66 s wall and 0.32 s system, against
6.4 s and 76 s for parallel worktree reads of the same files. Of that 0.66 s,
`--batch-check` — lookup with no content — is 0.21 s, leaving 0.23 s of inflate
and 0.37 s of system time that is almost entirely 67 MB crossing a pipe.

An mmapped pack reader removes the pipe and the process. It is worth about forty
percent of a number that is already cheap, against a correctness surface that
includes `.gitattributes` filters, `core.autocrlf`, LFS pointers, partial clones,
split index and sparse checkouts. Not now.

The file-list half is smaller still. Parsing `.git/index` directly is 32 ms at
200k paths against 65 ms for `ls-tree`, and `git status -uall` at that size runs
0.413 s wall at 754% CPU — it is already threaded, and a single-threaded lstat
loop does not beat it.

## What generalises

Neither defect is a slow loop, and neither needed a profiler. One had the answer
in a local variable; the other had it behind a flag that was switched off. Three
journals of measurements were already committed and did not prevent the second,
which landed after they were written.

That is [ADR-0069](../adr/0069-every-answer-has-an-owner.md): every answer has an
owner, and the question to ask before writing a loop is whose answer we are
ignoring.

The record also needs a correction.
[ADR-0040](../adr/0040-git-already-named-every-files-content.md) rejects
`git ls-files -s` on the grounds that the index is the staged state, which is
true of that porcelain command and not of the file. `.git/index` carries a
40-byte stat block per entry — ctime, mtime, dev, ino, mode, uid, gid, size —
which is what makes cleanliness decidable without hashing anything. A parser for
v2, v3 and v4 written for this investigation agreed with `git ls-files -s` on all
2,446 entries of this repository. The rejection was of the wrong thing; the
conclusion may still hold, but not for the reason written down.
