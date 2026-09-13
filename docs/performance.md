# What a run costs

The numbers on this page were taken on a repository this project did not write:
[Material UI](https://github.com/mui/material-ui) at `62a348bf47`, 41,165 tracked
paths, of which 24,519 are modules and 24.9 MB is source. Scanning it produces
24,909 records and a 7.4 MB index. It was chosen because it is large enough to
break things, public enough to check, and nobody here can tune for it.

Every figure below comes from one script, which is in the repository and takes a
clone of that repository as its argument:

```bash
node packages/sense/scripts/source-index.mjs {MATERIAL-UI}
```

## One whole run

A run opens the index, walks the repository, and publishes what it learned. Each
row is a working tree put into that shape and then put back, and the last two
columns are counted rather than inferred: a record is either reused or rebuilt,
and a rebuild either opens the file or answers from the content-keyed parse
cache.

| The tree is                          | Total    | Records rebuilt | Files opened |
| ------------------------------------ | -------- | --------------- | ------------ |
| new — no index at all                | 2,953 ms | 24,909          | 24,825       |
| unchanged since last run             | 622 ms   | 0               | 0            |
| four files edited                    | 599 ms   | 4               | 4            |
| five hundred files edited            | 639 ms   | 500             | 478          |
| one file added                       | 1,253 ms | 24,909          | 1            |
| a hundred in, a hundred out, five hundred edited | 1,293 ms | 24,909 | 479 |

The first row is the one people ask about and the least interesting. It happens
once per machine, and a machine that never has it happen is a machine that never
got a cold checkout.

**An edit is priced correctly and a fixed toll is charged on top of it.** Five
hundred files edited cost 40 ms more than four did — about a tenth of a
millisecond each, which is a file read, parsed and resolved. The 600 ms
underneath is charged whether anything changed or not. It is the walk: every path
in the repository visited and checked against its digest in order to decide not
to do anything about it. That cost is proportional to the repository and not to
the diff — half a second here, five on a repository ten times the size — and it
is the bug this stage has, stated as a number rather than as a caveat.

**A path appearing or disappearing charges the whole repository, once.** One file
added costs 1,253 ms. A hundred added, a hundred removed and five hundred edited
costs 1,293 ms — the same run, because the second one is not seven hundred times
the work. Both rebuild all 24,909 records, and the counters say why that is
survivable and why it is still wrong: 479 files were opened, not 24,909. A
resolution that answered `./Button` answered it out of a set of paths that just
changed, so every resolved record is invalidated; but parses are keyed by content
and survive it, so the rebuild reads almost nothing from disk and re-runs
resolution instead.

So the diff stops mattering the moment a path moves. A branch with a hundred
pull requests landing an hour is a branch where a path moves constantly, which
makes the fixed 1,250 ms the real number and the 600 ms the optimistic one. It
should cost nothing, and it will when a resolution is invalidated by the paths
that could have answered it rather than by the tree as a whole.

## Where the half-second is

Of a warm run's 622 ms, roughly 96 is decoding the index, 349 is the scan, and
177 is publishing. Inside the scan, about 84 ms is git answering what the working
tree looks like; the rest is walking 24,909 records and checking each against its
digest.

The publish is the part worth looking at, because of what it writes. A run that
changed nothing writes **nothing at all** — the index is an append-only chain of
immutable segments and an unchanged run has no segment to append. A run that
edited four files appends **4,136 bytes** to a 7.4 MB index. The whole of it is
re-encoded only when the chain has grown past eight segments, which is one
publish in eight and costs about 110 ms when it happens.

So the 177 ms is not writing. It is a chain decoded a second time in order to
compare against it, and a deep comparison of 24,825 parses and 24,909 records to
discover there is nothing to say. Both are ours and both are removable.

## The floor

Read every module and parse it, with nothing else happening:

| Doing only this                 | Costs  |
| ------------------------------- | ------ |
| read 24,519 files from disk     | 268 ms |
| parse them with oxc             | 179 ms |
| **what a scan cannot go below** | **447 ms** |

A cold scan is 2,796 ms against a floor of 447. The parser is not the problem —
it is 6% of the run, it is already compiled code, and it reads 24.9 MB of
TypeScript in 179 ms. The other 2,349 ms is resolution, specifier collection and
declaration indexing, all of it ours and all of it JavaScript.

That measurement is why [where the native code is](native-code.md) reads the way
it does. The gap is not the language; it is the amount of work being done above a
floor that is already native, and the fix for work that should not happen is not
to perform it faster.

## git, and the watcher

Everything this system knows about a working tree comes from git, and that is a
deliberate position: git is the arbiter of what changed, because it is the thing
a person will believe when the answer is wrong. It also means git's cost is ours.

| Asking git              | Costs | Which is                                     |
| ----------------------- | ----- | -------------------------------------------- |
| `ls-tree`               | 22 ms | the commit — does not grow with the checkout |
| `status`                | 86 ms | the working tree                             |
| `status`, watched       | 44 ms | the same answer, from a file-system monitor  |

Git ships the monitor. One line, in the repository being scanned:

```bash
git config core.fsmonitor true
```

It halves the half of git that scales with the checkout, and on a repository
where `git status` already takes seconds — which is the case at a few hundred
thousand files, with no unusual configuration required to get there — it is the
largest single change available, and none of it is code this project has to
ship.

The daemon is an accelerator and not a source of truth. It can be wrong after a
crash, on a network filesystem, and across a container boundary, and the answer
when it is wrong is that git recomputes. Nothing here caches on the watcher's
word alone.
