# Spec 0056 — An agent session holds the index

**Missing:** a reader that stays for the length of a session. Every CLI question
opens the published source index and decodes the whole chain first: about
650 ms on seven copies of Material UI (288,197 paths, 194,544 answered). Every
`variance index` walks all 194,544 held records to find out that nothing moved:
1.45–1.56 s. An agent asks dozens of questions between edits, and each one pays
both costs again. `variance serve` already holds a decoded generation in its own
process (`packages/cli/src/commands/serve.ts:43-45`), but only for MCP, and it
refreshes by age rather than by what moved. The CLI holds nothing.

## 1. The promise

An agent's session will start one resident index for its checkout and stop it
when the session ends. While it runs:

- A CLI question will be answered from memory. Before answering, the index will
  ask git what moved and fold that in. So an answer is never older than the
  question it answers, which is stronger than today's "answers from the last
  publish".
- A question where nothing moved will cost one `git status` at the root and one
  socket round trip. On the corpus above, with the repository's accelerators on,
  that status is 40 ms.
- A question after an edit will add the parse of the files that moved, and
  nothing else.
- Each fold that changed something will publish, so a reader that does not use
  the resident index still reads the latest generation.

## 2. Whose watcher it rides

Git and Watchman already watch the file system. A third watcher would be a
daemon, a state file, and answers that depend on what the process happened to
see while it ran. That is the objection that ruled out watching the file system
for the digest map, and it still holds. So the resident index adds no watcher,
and it does not subscribe to git's `fsmonitor--daemon` IPC, which is git's own
protocol and not a public one.

It asks instead, at the moment a question arrives:

- **What moved in the working tree:** `git status --porcelain=v1 -z
  --untracked-files=normal` at the root, the call the digest map already makes.
  It uses whatever the repository configured: `core.fsmonitor` with git's
  daemon, a Watchman hook, `core.untrackedCache`, or none of them.
- **Whether `HEAD` moved:** `git rev-parse HEAD`. When it has, `git diff-tree -r
  -z <old> <new>` names the moved paths and their object names. The object
  names are carried into the digest map, never hashed again.

The resident index holds decoded state. It holds no knowledge of change: git
decides what moved at every question. When git cannot answer, for example
because the checkout is gone or `status` fails, the index answers nothing and
exits. It never serves a reading it could not confirm.

It will not turn on `core.fsmonitor` or `core.untrackedCache`. Its first line
will say which of the two the repository has, and what a status cost at start:

```
variance index: holding 194,544 files for this checkout, pid 41210
  git status 40 ms (core.fsmonitor, core.untrackedCache)
```

## 3. Started and stopped with the agent

- **Started explicitly, never by a reader.** It starts with `variance index
  --resident`, run by the agent host at session start (a skill or a hook) or by
  hand. A reader that finds no resident index behaves exactly as it does today.
- **Stopped with the session.** It exits when the process that started it exits.
  It also stops on `variance index --resident --stop`. It does not guess from
  idle time: a session that is thinking is still a session.
- **One per checkout.** A second start prints the first one's pid and exits 0. A
  worktree is a checkout of its own.
- **CI does not start it.** CI has no session and no second question. The
  published generation stays the CI path.
- **`variance serve`.** When `serve` starts, it looks for a resident index and
  sends its questions there. It no longer refreshes a copy of its own by age.

## 4. What the user sees

The user always sees where an answer came from. Every answer the resident index
served will say so in one line on stderr, with the pid, the `HEAD` the answer is
against, and how many files the question folded in:

```
answered by the resident index (pid 41210) at 8f19b1009b, 3 files folded in
```

A question answered without a resident index prints no such line, and its
output stays byte-identical to today's. The socket and a pid file will live next
to the published generation, under the same cache key.

## 5. What it holds

It will hold the columns of the published generation, not the objects
`decodeSourceIndex` builds. On the corpus the published generation is 44 MB
on disk, in two segments. The update process peaks at 0.93–0.97 GB, most of
which is the decoded form. The lean reader behind `ask search` already reads one segment in
place with a binary search over code-unit-sorted paths. The resident index
extends that reader to the whole chain. A fold appends a segment, as an update
does now, and compaction stays the log's.

## 6. What will discharge this spec

On the seven-Material-UI corpus, measured by
`packages/sense/scripts/published-index.mjs` with a new row per case:

1. A question where nothing moved costs less than 100 ms whole process, with the
   repository's accelerators on.
2. A question after one edit returns an answer that includes the edit, in less
   than 100 ms plus that file's parse.
3. Every answer equals the answer of `variance index` followed by a cold reader
   over the same tree, across the edit, add, delete, rename, `HEAD`-moved and
   collapsed-directory cases in `packages/sense/src/native.test.ts`.
4. Killing the process that started it ends the resident index within one
   second, and removes its socket and pid file.
5. With no resident index, every reader's output is byte-identical to its
   output before this spec.
6. Resident memory stays within twice the size of the published generation.

## 7. Out of scope

- A watcher of our own, in any form.
- Starting a resident index from a reader, the first time it is slow.
- Holding the run report, which `serve` already reads per request.
