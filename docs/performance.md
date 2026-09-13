# What a run costs

The numbers on this page were taken on a repository this project did not write:
[Material UI](https://github.com/mui/material-ui) at `62a348bf47`, 41,165 tracked
paths, of which 24,519 are modules and 24.9 MB is source. Scanning it produces
24,909 records and a 7.9 MB index. It was chosen because it is large enough to
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
| new — no index at all                | 3,084 ms | 24,909          | 24,825       |
| unchanged since last run             | 659 ms   | 0               | 0            |
| four files edited                    | 697 ms   | 4               | 4            |
| five hundred files edited            | 819 ms   | 500             | 478          |
| one file added                       | 719 ms   | 104             | 1            |
| a hundred in, a hundred out, five hundred edited | 935 ms | 1,064 | 479 |

The first row is the one people ask about and the least interesting. It happens
once per machine, and a machine that never has it happen is a machine that never
got a cold checkout.

**An edit is priced correctly and a fixed toll is charged on top of it.** Five
hundred files edited cost 122 ms more than four did — about a quarter of a
millisecond each, which is a file read, parsed and resolved. The 650 ms
underneath is charged whether anything changed or not. It is the walk: every path
in the repository visited and checked against its digest in order to decide not
to do anything about it. That cost is proportional to the repository and not to
the diff — two thirds of a second here, five on a repository ten times the size —
and it is the bug this stage has, stated as a number rather than as a caveat.

**A path appearing costs the directory it appeared in.** One file added rebuilds
104 records, because a record's edges depend on the bytes of the file, on how
resolution is configured, and on the membership of the directories its own
specifiers could have been answered from — nothing else. A hundred added, a
hundred removed and five hundred edited touch more directories and so rebuild
1,064 — the 500 the edit is worth, plus the neighbours of the two hundred paths
that moved. The work tracks the diff, which is the property that makes an index
worth keeping on a branch taking a hundred pull requests an hour.

The exception is a repository whose `tsconfig` cannot be read. A bare specifier
is bounded by the `paths` a configuration declares, so a configuration that
cannot be parsed is no bound at all, and there every added path invalidates
every record. That is a real cost and it is charged on that repository only.
[ADR-0059](context/adr/0059-a-record-is-invalidated-by-what-could-have-answered-it.md)
carries the argument for why the bound is sound everywhere else.

## Where the half-second is

Of a warm run's 659 ms, roughly 130 is decoding the index, 340 is the scan, and
189 is publishing. Inside the scan, about 86 ms is git answering what the working
tree looks like; the rest is walking 24,909 records and checking each against its
digest.

The publish is the part worth looking at, because of what it writes. A run that
changed nothing writes **nothing at all** — the index is an append-only chain of
immutable segments and an unchanged run has no segment to append. A run that
edited four files appends about **14,000 bytes** to a 7.9 MB index. The whole of
it is re-encoded only when the chain has grown past eight segments, which is one
publish in eight and costs about 150 ms more than an append.

So the 189 ms is not writing. It is a chain decoded a second time in order to
compare against it, and a deep comparison of 24,825 parses and 24,909 records to
discover there is nothing to say. Both are ours and both are removable.

## The floor

Read every module and parse it, with nothing else happening:

| Doing only this                 | Costs  |
| ------------------------------- | ------ |
| read 24,519 files from disk     | 239 ms |
| parse them with oxc             | 156 ms |
| **what a scan cannot go below** | **395 ms** |

A cold scan is 2,943 ms against a floor of 395. The parser is not the problem —
it is 5% of the run, it is already compiled code, and it reads 24.9 MB of
TypeScript in 156 ms. The other 2,548 ms is resolution, specifier collection and
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
| `ls-tree`               | 23 ms | the commit — does not grow with the checkout |
| `status`                | 86 ms | the working tree                             |
| `status`, watched       | 46 ms | the same answer, from a file-system monitor  |

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
