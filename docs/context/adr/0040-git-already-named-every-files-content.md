# ADR-0040 — git already named every file's content, and a scan is keyed by what it names

**Status:** accepted
**Date:** 2026-08-13
**Relates to:** [ADR-0004](0004-defer-native-acceleration.md),
[ADR-0038](0038-a-change-reaches-a-component-through-files.md),
[ADR-0039](0039-the-digest-is-the-proof-the-trail-is-the-explanation.md),
[`packages/sense/src/tree.ts`](../../../packages/sense/src/tree.ts) (the digests),
[`packages/sense/src/cache.ts`](../../../packages/sense/src/cache.ts) (the parses),
[`packages/sense/src/reuse.ts`](../../../packages/sense/src/reuse.ts) (the records),
[journal 0025](../journal/0025-what-a-second-scan-costs.md)

## Context

The scan sits on the path of every run that selects, so its cost is paid before
any saving is realised. On this repository — 30,500 files, 40,479 edges — a cold
scan is about three seconds, which is tolerable. The target is not this
repository. A frontend of the size this is meant for is 200,000 files and 14
million lines, where the same work is minutes, and a selector that costs minutes
is a selector nobody enables.

Three things cost money, in this order: opening and decoding every file, parsing
it, and resolving every specifier it contains. The obvious optimisation — cache
parses by content digest — requires knowing the content digest, and computing that
the obvious way costs a read of every file in the repository. The cache pays for
itself and the key does not.

It also only removes the middle cost. Resolution is per-specifier, hits the
filesystem, and is not a function of one file's bytes.

## Decision

**Three layers, each keyed by what names it.**

**`git` names every file's content without opening one.** A blob's name *is* the
hash of its contents — that is what a git object is — so `git ls-tree -r -z HEAD`
hands over the entire file list with a digest attached, in one subprocess, having
read nothing. The working tree is not the commit, so `git status --porcelain`
follows and every path it names is re-hashed with `hash-object`: a file edited
back to its committed contents lands on its committed digest and nothing runs for
it. Deleted paths are dropped; paths git does not know about get no digest and the
scan hashes them itself. Failure returns `undefined` rather than throwing — a
tarball, a sandbox, a checkout with no `HEAD` is slower and not broken.

**A digest names the parse, and that cache can never go stale.** Two files with
one digest had one content, on any machine, in any branch, in any year. A CI
runner that has never seen this branch still holds an entry for nearly every blob
in it. There is no invalidation rule because there is no way for the key to be
wrong.

**A digest plus the shape of the tree names the whole record, edges included.**
Edges are not a function of the bytes alone: resolving `./later` depends on which
paths exist and on how resolution is configured. A record is a function of exactly
four things — the file's bytes, where the file sits, which paths exist, and the
resolver settings — so the record cache is keyed by the digest *and* by a **layout
digest** over the path set plus `tsconfig` and condition names, with the content
digest folded in for the files that decide resolution (`package.json`,
`tsconfig*.json`, the lockfiles, `pnpm-workspace.yaml`). Any file appearing,
disappearing or moving changes the layout and costs one full scan. Every run that
only edits files costs the diff.

**The scanned directories are deliberately excluded from the layout digest**, so a
narrower run reuses a wider run's records rather than discarding them.

**Both caches live outside the work tree**, under `XDG_CACHE_HOME`, the record
cache keyed by repository root — because the layout digest is one value for the
whole tree, and two checkouts sharing one cache would each discard the other's
records on every run.

## Consequences

**A warm scan costs the diff rather than the repository.** Measured on this
repository, one Mac, `yarn workspace @variance-authority/sense bench`
([journal 0025](../journal/0025-what-a-second-scan-costs.md)): 95 ms to name
30,501 files, 3002 ms cold, 657 ms with parses remembered, 236 ms with records
remembered too, and 236 ms for the run after a one-file edit — the edit is inside
the run-to-run noise. The residue is the directory walk, and roughly 95 ms of
those last two numbers is the `git` call itself.

**It answers the Rust question honestly, and the answer is no.** ADR-0004 defers
native acceleration until a recorded benchmark shows the JavaScript path is the
constraint. It is not: parsing was never the expensive half once it was cached —
resolution was — and resolution is now eliminated in JavaScript rather than made
faster. A rewrite would be competing against 232 ms of directory walking and
subprocess.

**A file git cannot see does not move the layout.** A gitignored file that
resolution would depend on is a bounded hole: it can never appear in a diff
either, so nothing selects on it, and `digests: false` turns the whole mechanism
off for a caller who needs that. It is stated in `reuse.ts` rather than left to be
discovered.

**A scan that adopted no layout writes no cache.** Otherwise a `digests: false`
run would clobber a usable record cache with an empty one, and the next run would
pay cold for a saving it already had.

**Nothing here can produce a different graph.** Every key is content-addressed, so
a stale entry, a cache from another branch, or no cache at all costs a slower scan
and nothing else. That is what makes the cache location a cost decision the
environment is allowed to make, when the config file refuses inferred values
everywhere that changes what is observed.

## Alternatives

**Hash the files ourselves in parallel.** Rejected. It is the read of every file
that the digest exists to avoid, and no amount of concurrency makes 200,000 opens
cheaper than one subprocess that opens none.

**`git ls-files -s` instead of `ls-tree`.** It reads the index, which is the
staged state rather than either the commit or the working tree, so an unstaged
edit would carry a stale digest — the one unforgivable error here, a file that
moved reported as still. `ls-tree` plus a porcelain overlay says what is on disk.

**Watch the filesystem instead.** Rejected. A watcher is a daemon, a state file
and a class of bug where the answer depends on what the process saw while it was
running. CI has no previous process, and CI is where this has to be fast.

**One cache keyed by digest for everything, records included.** Rejected, and it
was the first draft: it is wrong. Two runs where the same file has the same bytes
can legitimately produce different edges, because a file it names appeared. The
layout digest is the price of that being a cache rather than a bug.

**Invalidate the record cache by watching resolution inputs only** — `tsconfig`,
lockfiles, `package.json`. Rejected. A plain new file changes resolution too:
`./later` resolving to nothing yesterday and to `src/later.ts` today is exactly
the case, and it touches no config file.
