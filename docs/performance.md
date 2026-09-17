# What a run costs

[**Variance Authority**](README.md) is visual and execution regression tooling: it renders
**subjects** — the stories, routes, fixtures and values a run observes — against
their baselines and records what changed and why. Before a **run** (one
execution of `variance run`) can capture anything, it has to know which subjects
a code change could have reached, and that answer comes from an incremental,
content-addressed index of the checkout: **unchanged runs reuse it**, edits
rebuild changed records, and path additions invalidate only records whose
specifiers could have named the affected directory.

This page prices that index, which is the part of a run that grows with your
repository rather than with your suite. On the checkout below a warm run spends
357 ms on it. One Chromium paint of one subject costs 54 ms on the todomvc
fixture in [instruments](instruments.md), where the render and the comparison
are priced per subject — so the whole index stage costs about what painting
seven subjects costs, and a suite of any size pays it once.

The figures were taken on a repository this project did not write:
[Material UI](https://github.com/mui/material-ui) at `62a348bf47`, 41,165
tracked paths, of which 24,519 are modules and 24.9 MB is source. Scanning it
produces 24,909 records and a 7.8 MB index. It was chosen because it is large
enough to break things, public enough to check, and nobody here can tune for
it. Every millisecond below was taken on an Apple M4 Max (Mac16,9) — 12
performance cores, 4 efficiency, 64 GB, macOS 27.0 on arm64, Node v26.7.0,
Yarn 4.18.0 — on a local SSD with a warm filesystem cache, which makes these
figures the fast end of the range and a floor rather than a budget: size a CI
container above them, not against them.

Three counts appear below and they are not the same count. **Multiply by
records.** 24,519 is the module files git lists; 24,909 is the records the index
holds, because the walk also records stylesheets and declaration files that the
module listing excludes; and 24,859 is how many of those a cold build opened,
the rest answering from the parse cache because a file with the same content had
already been parsed.

## How these were measured

Every figure comes from `packages/sense/scripts/source-index.mjs`, run against a
clone of that checkout. It is a contributor tool in this project's repository and
not part of the published package.

The cache is warm by construction: the floor stage reads all 24,519 module files
before the first run is timed, so even the cold-index row runs against a warm
filesystem. Milliseconds move with the machine; the ratios between rows move much
less.

The git rows and the floor rows are each the median of five timings. **Each row
of the run table is one timing of one run.** Read the column for its shape and
not for a difference of a few tens of milliseconds: `unchanged since last run`
and `four files edited` sit 25 ms apart in the wrong order, and that inversion is
the spread of a single sample rather than a finding.

## One whole run

This is what that index costs to keep current: a run opens it, walks the
repository, and publishes what it learned back into it. Each row is a working
tree put into that shape and then put back, and the last two
columns are counted rather than inferred: a record is either reused or rebuilt,
and a rebuild either opens the file or answers from the parse cache, which is
keyed by content and by what the file's name said about reading it.

| The tree is                          | Total    | Records rebuilt | Files opened |
| ------------------------------------ | -------- | --------------- | ------------ |
| new — no index at all                | 2,866 ms | 24,909          | 24,859       |
| unchanged since last run             | 357 ms   | 0               | 0            |
| four files edited                    | 332 ms   | 4               | 4            |
| five hundred files edited            | 460 ms   | 500             | 490          |
| one file added                       | 373 ms   | 104             | 1            |
| a hundred in, a hundred out, five hundred edited | 462 ms | 1,064 | 491 |

You pay the first row on a fresh clone and on a CI runner with nothing cached,
and once per machine after that. It peaks at **533 MB resident**, which is the
number to size a container against — the rest of the rows hold the index and walk
it, and the cold build is where the whole repository is in memory at once.

**An edit is priced correctly and a fixed toll is charged on top of it.** Five
hundred files edited cost about 130 ms more than four did — roughly a quarter of a
millisecond each, which is a file read, parsed and resolved. The 330 ms underneath
is charged whether anything changed or not, and a quarter of it is git. The rest
is the walk — every path in the repository visited and checked against its digest
in order to decide not to do anything about it — plus the index decoded so that
there is something to check it against. Both are proportional to the repository
rather than to the diff.

### Budget for your own checkout

Scale by tracked paths, not by your diff:

| Multiply                | By                 | To get                                              |
| ----------------------- | ------------------ | --------------------------------------------------- |
| every tracked path      | about 9 µs         | a warm run, of which roughly 2 µs a path is git's `status` |
| every record            | about 115 µs       | the one cold build                                  |
| every record            | about 310 bytes    | the index on disk                                   |

A 9,000-path checkout of similar module density is therefore an 80 ms warm run.
A 400,000-path checkout pays the fixed toll ten times over: budget around three
and a half seconds of walk and index decode on every run, and turn on the two git
accelerators at the end of this page before you do anything else. Those are
extrapolations from the constants above on one checkout, not second measurements.

**A path appearing costs the directory it appeared in.** One file added rebuilds
104 records, because a record's edges depend on the bytes of the file, on how
resolution is configured, and on the membership of the directories its own
specifiers could have been answered from — nothing else. A hundred added, a
hundred removed and five hundred edited touch more directories and so rebuild
1,064 — the 500 the edit is worth, plus the neighbours of the two hundred paths
that moved. The work tracks the diff, which is the property that makes an index
worth keeping on a branch taking a hundred pull requests an hour.

**That 104 is one directory's answer, and the distribution is the claim.** The
cost of an appearance is the number of records watching the directory it
appeared in, so the whole shape is reported rather than one row of it. Over the
Material UI checkout, 1,492 directories, 478 of them watched by anything, and a
record watches 1.2 directories on average. The table reads the other direction —
how many records watch one directory, which is what an appearance costs — and
that direction is skewed enough that its mean would tell you nothing:

| One path appears in a directory, and it rebuilds | Records |
| ------------------------------------------------ | ------- |
| the median directory                              | 7       |
| the 90th percentile                               | 34      |
| the 99th percentile                               | 271     |
| the worst directory in that checkout               | 21,500  |

The tail is not a defect and is worth understanding before it surprises anyone.
The worst directory there is `packages/mui-icons-material/lib/utils`, which holds
the one module that 21,506 generated icons import. Every one of them genuinely
depends on what that directory contains, so every one of them is rebuilt when its
membership changes — which is to say a regeneration of the icons is a cold run,
and nothing else in that checkout is. A barrel concentrates dependence, and an
index can only price what the code actually says.

The exception is a repository whose `tsconfig` cannot be read. A bare specifier
is bounded by the `paths` a configuration declares, so a configuration that
cannot be parsed is no bound at all, and there every added path invalidates
every record. That is a real cost and it is charged on that repository only.
Everywhere else, the recorded dependency boundary defines which added paths
could have changed the answer and therefore which records must be invalidated.

## Where the third of a second is

Of a warm run's 357 ms, roughly 123 is decoding the index, 220 is the scan, and 13
is publishing. Inside the scan, 84 ms is git answering what the working tree looks
like, which leaves about 136 ms of ours: 24,909 records walked and each checked
against its digest.

The publish is the smallest of the three because of how little it writes. A run
that changed nothing writes **nothing at all** — the index is an append-only chain
of immutable segments, and an unchanged run has no segment to append. A run that
edited four files appends about **14,000 bytes** to the 7.8 MB index. The whole of it
is re-encoded only when the chain has grown past eight segments, which is one
publish in eight and costs about 150 ms more than an append.

Deciding what to append is the rest of it, and what bounds that is keeping the
generation the run opened. A save compares against the chain already in memory and
re-reads only the manifest — one small file naming the segments — so the segments
are decoded a second time only on the run where another writer published
underneath this one. A row the scan reused is the row it was handed, so most of
that comparison answers on a pointer.

The walk is bounded by the same kind of frugality. A record's key is its
repository-relative path, and a resolved edge already carries one, so the queue
stays repository-relative from end to end rather than converting each path to an
absolute one and back in order to visit it.

What the walk does spend, it spends on being right. Each file's parse-cache key
covers the content digest *and* what the name said about reading it — the
extension picks the parser's dialect, and a `.test.ts` is deliberately not
indexed for declarations. Keyed on the digest alone, the cache handed
`widget.test.ts`'s answer to `widget.ts` beside it, in whichever order the walk
reached them.

## The floor

Read every module and parse it, with nothing else happening:

| Doing only this                 | Costs  |
| ------------------------------- | ------ |
| read 24,519 files from disk     | 273 ms |
| parse them with oxc             | 157 ms |
| **read and parse, back to back** | **430 ms** |

Those two are timed one after the other, and a scan reads asynchronously — so
some of the reading happens while a parse is running, and a scan's true lower
bound is somewhere between the 157 ms of parsing and the 430 ms of both.

Either way the parser is not the problem. A cold scan is 2,866 ms: the parse is
5% of it, it is already compiled code, and it reads 24.9 MB of TypeScript in
157 ms. The remaining two and a half seconds is resolution, specifier collection
and declaration indexing, all of it ours and all of it JavaScript.

That measurement is why [where the native code is](native-code.md) reads the way
it does. The gap is not the language; it is the amount of work being done above a
floor that is already native, and the fix for work that should not happen is not
to perform it faster.

## git, and the watcher

Everything Variance Authority knows about a working tree comes from git, and
that is a deliberate position: git is the arbiter of what changed, because it is the thing
a person will believe when the answer is wrong. It also means git's cost is ours.

| Asking git                 | Costs | Which is                                     |
| -------------------------- | ----- | -------------------------------------------- |
| `ls-tree`                  | 22 ms | the commit — does not grow with the checkout |
| `status`                   | 84 ms | the working tree                             |
| `status`, watched          | 45 ms | the same answer, from a file-system monitor  |
| `status`, watched and cached | 44 ms | the untracked walk remembered as well      |

Git ships both. Two lines, in the repository you are scanning:

```bash
git config core.fsmonitor true
git config core.untrackedCache true
```

The monitor answers for tracked files, and it is what takes `status` from 84 ms to
45 here. The untracked cache answers the other half of the same question — what is
on disk that the index has never heard of — and it does not move this row, because
these figures require a clean checkout and the walk it spares therefore finds
nothing. On a working tree with build output in it, that is the half that costs.

Both scale with the checkout rather than with the diff, so they matter more the
larger the working tree gets, and neither is code this project has to ship.

The daemon is an accelerator and not a source of truth. It can be wrong after a
crash, on a network filesystem, and across a container boundary, and the answer
when it is wrong is that git recomputes. Nothing here caches on the watcher's
word alone.
