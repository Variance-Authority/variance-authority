# What a source scan costs

Before a [Variance Authority](README.md) run can capture anything, it has to know
which **subjects** — a subject is one named UI state you asked for and can ask
for again — a code change could have reached. That answer comes from an
incremental, content-addressed index of your checkout: an unchanged run reuses
it, edits rebuild changed records, and a path appearing invalidates only the
records whose specifiers could have named the affected directory.

This page prices that scan and only that scan. It is the part of a run that
grows with your repository rather than with your suite: on the checkout below a
warm run spends 357 ms on it, and a suite of any size pays it once. What one
subject costs to paint and compare is priced per subject in
[instruments](instruments.md), where one Chromium paint costs 54 ms on the
todomvc fixture — so the whole scan costs about what painting seven subjects
costs.

The figures were taken on a repository this project did not write:
[Material UI](https://github.com/mui/material-ui) at `62a348bf47`, 41,165
tracked paths, of which 24,519 are modules and 24.9 MB is source. Scanning it
produces 24,909 records and a 7.8 MB index. Every millisecond below was taken on
an Apple M4 Max (Mac16,9) — 12 performance cores, 4 efficiency, 64 GB, macOS
27.0 on arm64, Node v26.7.0, Yarn 4.18.0 — on a local SSD with a warm filesystem
cache, which makes these figures the fast end of the range and a floor rather
than a budget: size a CI container above them, not against them.

Three counts appear below and they are not the same count. **Multiply by
records.** 24,519 is the module files git lists; 24,909 is the records in the
index, because the walk also records stylesheets and declaration files that the
module listing excludes; and 24,859 is how many of those a cold build opened,
the rest answering from the parse cache because a file with the same content had
already been parsed.

## How these were measured

Every figure comes from `packages/sense/scripts/source-index.mjs`, run against a
clone of that checkout.

The cache starts warm: the floor stage reads all 24,519 module files before the
first run is timed, so even the cold-index row runs against a warm filesystem.
Milliseconds change with the machine; the ratios between rows change much less.

The git rows and the floor rows are each the median of five timings. **Each row
of the run table is one timing of one run.** Read the column for its shape and
not for a difference of a few tens of milliseconds: `unchanged since last run`
and `four files edited` sit 25 ms apart in the wrong order, and that inversion is
the spread of a single sample rather than a finding.

## One whole scan

This is what the index costs to keep current: a run opens it, walks the
repository, and publishes what it learned back into it. Each row is a working
tree put into that shape and then put back, and the last two columns are counted
rather than inferred: a record is either reused or rebuilt, and a rebuild either
opens the file or answers from the parse cache, which is keyed by content and by
what the file's name said about reading it.

| The tree is                          | Total    | Records rebuilt | Files opened |
| ------------------------------------ | -------- | --------------- | ------------ |
| new — no index at all                | 2,866 ms | 24,909          | 24,859       |
| unchanged since last run             | 357 ms   | 0               | 0            |
| four files edited                    | 332 ms   | 4               | 4            |
| five hundred files edited            | 460 ms   | 500             | 490          |
| one file added                       | 373 ms   | 104             | 1            |
| a hundred in, a hundred out, five hundred edited | 462 ms | 1,064 | 491 |

You pay the first row on a fresh clone and on a CI runner with nothing cached,
and once per machine after that. The cold build is where the whole repository is
read at once; every row after it opens the index and walks the tree.

**An edit costs per file, over a fixed toll.** Five hundred files edited cost
about 130 ms more than four did — roughly a quarter of a millisecond each, which
is a file read, parsed and resolved. The 330 ms underneath is charged whether
anything changed or not, and a quarter of it is git. The rest is the walk — every
path in the repository visited and checked against its digest to decide not to
do anything about it — plus the index decoded so that there is something to
check it against. Both are proportional to the repository rather than to the
diff.

### Scale these to your own checkout

Scale by tracked paths, not by your diff:

| Multiply                | By                 | To get                                              |
| ----------------------- | ------------------ | --------------------------------------------------- |
| every tracked path      | about 9 µs         | a warm run, of which roughly 2 µs a path is git's `status` |
| every record            | about 115 µs       | the one cold build                                  |
| every record            | about 310 bytes    | the index on disk                                   |

A 9,000-path checkout of similar module density is an 80 ms warm run.
A 400,000-path checkout pays the fixed toll ten times over: budget around three
and a half seconds of walk and index decode on every run, and turn on the two git
accelerators further down this page before you do anything else. Those are
extrapolations from the constants above on one checkout, not second measurements.

**A path appearing costs the directory it appeared in.** One file added rebuilds
104 records, because a record's edges depend on the bytes of the file, on how
resolution is configured, and on the membership of the directories its own
specifiers could have been answered from — nothing else. A hundred added, a
hundred removed and five hundred edited touch more directories and so rebuild
1,064 — the 500 the edit is worth, plus the neighbours of the two hundred paths
that moved. The work tracks the diff rather than the repository.

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

The worst directory there is `packages/mui-icons-material/lib/utils`, home to
the one module that 21,506 generated icons import. Every one of them genuinely
depends on what that directory contains, so every one of them is rebuilt when its
membership changes — which is to say a regeneration of the icons costs what a
cold run costs, and nothing else in that checkout does. Expect the same wherever
a barrel sits under a generated directory.

One repository shape removes that bound: a `tsconfig` that cannot be read. A bare
specifier is bounded by the `paths` a configuration declares, so a configuration
that cannot be parsed is no bound at all, and there every added path invalidates
every record. The symptom is a warm run that costs what a cold one does.

## Where the third of a second is

Of a warm run's 357 ms, roughly 123 is decoding the index, 220 is the scan, and 13
is publishing. Inside the scan, 84 ms is git answering what the working tree looks
like, which leaves about 136 ms of ours: 24,909 records walked and each checked
against its digest.

The publish is the smallest of the three because of how little it writes. A run
that changed nothing writes nothing — the index is an append-only chain of
immutable segments, and an unchanged run has no segment to append. A run that
edited four files appends about **14,000 bytes** to the 7.8 MB index. The whole of
it is re-encoded only when the chain has grown past eight segments, which is one
publish in eight and costs about 150 ms more than an append.

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

Either way the parser is not where the time goes. A cold scan is 2,866 ms: the
parse is 5% of it, it is already compiled code, and it reads 24.9 MB of
TypeScript in 157 ms. The remaining two and a half seconds is resolution,
specifier collection and declaration indexing, all of it ours and all of it
JavaScript. [Where the native code is](native-code.md) takes that split further.

## Caching the index in CI

Without a restored index, every CI run pays the cold row — 2,866 ms on the
checkout above. The index lives outside the checkout, at:

```text
${XDG_CACHE_HOME:-~/.cache}/variance-authority/scans/v1-<checkout>/source-index.bin
```

`<checkout>` is a digest of the checkout's **absolute path**. Beside the file is a
directory `source-index.bin.segments/`, where the data lives; the file itself is
only a pointer to which segments are current, and a pointer naming segments that
are not there is rejected whole. Cache the directory both sit in, and restore it
before the scan.

A run pays the cold row when:

- **nothing was restored**, on a fresh runner or after you deleted the directory;
- **the index was restored to a different absolute path** than it was written
  from. Records are keyed by the repository root, so a runner using a per-job
  directory keeps the parses and rebuilds every record; a runner that checks out
  at a fixed workspace path keeps both halves;
- **only half of it was restored** — the pointer file without its segments
  directory, or the other way round;
- **it came from a machine of different endianness**. Four-byte sections are
  written in the writing host's byte order, and nothing in the file records which
  that was;
- **a manifest, a lock file, or any `tsconfig*.json` or `jsconfig.json` changed.**
  The parses survive; every record is rebuilt, because one `paths` entry can
  redirect every bare specifier in the repository.

Branch and commit do not belong in the cache key: both halves are
content-addressed, so an index restored from another branch costs a slower scan
and cannot produce a different graph. [The source index
format](source-index.md) gives the rest of the rules and what each half stores.

## git, and the watcher

Everything Variance Authority knows about a working tree comes from git, which
means git's cost is yours.

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
on disk that the index has never heard of — and it does not change this row,
because these figures require a clean checkout and the walk it spares finds
nothing. On a working tree with build output in it, that is the half that costs.

Both scale with the checkout rather than with the diff, so they matter more the
larger the working tree gets.

The monitor can be wrong after a crash, on a network filesystem, and across a
container boundary. When it is, git recomputes.
