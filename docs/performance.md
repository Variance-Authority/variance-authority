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

A run opens the index, walks the repository, and publishes what it learned.

| The tree is                | Total    | Open   | Scan   | Publish |
| -------------------------- | -------- | ------ | ------ | ------- |
| new — no index at all      | 2,648 ms | —      | 2,523  | 125     |
| unchanged since last run   | 568 ms   | 91     | 314    | 163     |
| four files edited          | 583 ms   | 96     | 313    | 174     |
| one file added             | 1,053 ms | 91     | 790    | 172     |
| one file removed           | 1,035 ms | 98     | 777    | 160     |

The first row is the one people ask about and the least interesting. It happens
once per machine, and a machine that never has it happen is a machine that never
got a cold checkout.

The second and third rows are the interesting ones, and what they say is not
flattering: **editing four files costs the same as editing none.** Nothing in the
warm path is proportional to the diff. It is proportional to the repository —
half a second here, and five seconds on a repository ten times the size. The
scan does avoid the expensive work per file, which is why the row is 568 ms and
not 2,648, but avoiding work still means visiting every path to decide to avoid
it. That is the bug this stage has, stated as a number rather than as a caveat.

The last two rows are a second bug, and a coarser one. A file appearing or
disappearing invalidates every resolved record in the repository, because a
resolution that answered `./Button` answered it out of a set of paths that just
changed, and the index has no finer statement than *the set of paths changed*.
The rebuild is cheap — parses are keyed by content, survive the invalidation, and
are what the records are rebuilt from — so it costs 480 ms rather than another
cold build. It should cost nothing, and it will when a resolution is invalidated
by the paths that could have answered it rather than by the tree as a whole.

## Where the half-second is

Of a warm run's 568 ms, roughly 90 is decoding the index, 314 is the scan, and
165 is publishing. Inside the scan, about 86 ms is git answering what the working
tree looks like; the rest is walking 24,909 records and checking each against its
digest.

The publish is the part worth looking at, because of what it writes. A run that
changed nothing writes **nothing at all** — the index is an append-only chain of
immutable segments and an unchanged run has no segment to append. A run that
edited four files appends **4,136 bytes** to a 7.4 MB index. The whole of it is
re-encoded only when the chain has grown past eight segments, which is one
publish in eight and costs about 110 ms when it happens.

So the 165 ms is not writing. It is a chain decoded a second time in order to
compare against it, and a deep comparison of 24,825 parses and 24,909 records to
discover there is nothing to say. Both are ours and both are removable.

## The floor

Read every module and parse it, with nothing else happening:

| Doing only this                 | Costs  |
| ------------------------------- | ------ |
| read 24,519 files from disk     | 226 ms |
| parse them with oxc             | 152 ms |
| **what a scan cannot go below** | **378 ms** |

A cold scan is 2,523 ms against a floor of 378. The parser is not the problem —
it is 6% of the run, it is already compiled code, and it reads 24.9 MB of
TypeScript in 152 ms. The other 2,145 ms is resolution, specifier collection and
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
