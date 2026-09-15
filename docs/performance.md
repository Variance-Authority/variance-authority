# What a run costs

The numbers on this page were taken on a repository this project did not write:
[Material UI](https://github.com/mui/material-ui) at `62a348bf47`, 41,165 tracked
paths, of which 24,519 are modules and 24.9 MB is source. Scanning it produces
24,909 records and a 7.8 MB index. It was chosen because it is large enough to
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

The first row is the one people ask about and the least interesting. It happens
once per machine, and a machine that never has it happen is a machine that never
got a cold checkout.

**An edit is priced correctly and a fixed toll is charged on top of it.** Five
hundred files edited cost 128 ms more than four did — about a quarter of a
millisecond each, which is a file read, parsed and resolved. The 330 ms underneath
is charged whether anything changed or not, and a quarter of it is git. The rest
is the walk — every path in the repository visited and checked against its digest
in order to decide not to do anything about it — plus the index decoded so that
there is something to check it against. Both are proportional to the repository
rather than to the diff, and that is the shape this stage still has to answer for
on a checkout ten times this size.

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
appeared in, so the same script reports the whole shape rather than one row of
it. Over this repository, 1,492 directories, 478 of them watched by anything,
1.2 witnesses per record:

| One path appears in a directory, and it rebuilds | Records |
| ------------------------------------------------ | ------- |
| the median directory                              | 7       |
| the 90th percentile                               | 34      |
| the 99th percentile                               | 271     |
| the worst directory in the repository             | 21,500  |

The tail is not a defect and is worth understanding before it surprises anyone.
The worst directory here is `packages/mui-icons-material/lib/utils`, which holds
the one module that 21,506 generated icons import. Every one of them genuinely
depends on what that directory contains, so every one of them is rebuilt when its
membership changes — which is to say a regeneration of the icons is a cold run,
and nothing else in this repository is. A barrel concentrates dependence, and an
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
edited four files appends about **14,000 bytes** to a 7.7 MB index. The whole of it
is re-encoded only when the chain has grown past eight segments, which is one
publish in eight and costs about 150 ms more than an append.

Deciding what to append is the rest of it, and what bounds that is keeping the
generation the run opened. A save compares against the chain already in memory and
re-reads only the manifest — one small file naming the segments — so the segments
are decoded a second time only on the run where another writer published
underneath this one. A row the scan reused is the row it was handed, so most of
that comparison answers on a pointer.

The walk is bounded by the same kind of frugality. A record's key is its
repository-relative path, and a resolved edge already carries one; converting it
to an absolute path and back in order to visit it is 48,738 conversions on this
repository for a run that opens no files at all.

What the walk does spend, it spends on being right. Each file's parse-cache key
covers the content digest *and* what the name said about reading it — the
extension picks the parser's dialect, and a `.test.ts` is deliberately not
indexed for declarations — so building one key per file costs the warm run
roughly 15 ms it did not pay when the key was the digest alone. The digest alone
handed `widget.test.ts`'s answer to `widget.ts` beside it, in whichever order the
walk reached them, which is not a saving.

## The floor

Read every module and parse it, with nothing else happening:

| Doing only this                 | Costs  |
| ------------------------------- | ------ |
| read 24,519 files from disk     | 273 ms |
| parse them with oxc             | 157 ms |
| **what a scan cannot go below** | **430 ms** |

A cold scan is 2,866 ms against a floor of 430. The parser is not the problem — it
is 5% of the run, it is already compiled code, and it reads 24.9 MB of TypeScript
in 157 ms. The other 2,436 ms is resolution, specifier collection and declaration
indexing, all of it ours and all of it JavaScript.

That measurement is why [where the native code is](native-code.md) reads the way
it does. The gap is not the language; it is the amount of work being done above a
floor that is already native, and the fix for work that should not happen is not
to perform it faster.

## git, and the watcher

Everything this system knows about a working tree comes from git, and that is a
deliberate position: git is the arbiter of what changed, because it is the thing
a person will believe when the answer is wrong. It also means git's cost is ours.

| Asking git                 | Costs | Which is                                     |
| -------------------------- | ----- | -------------------------------------------- |
| `ls-tree`                  | 22 ms | the commit — does not grow with the checkout |
| `status`                   | 84 ms | the working tree                             |
| `status`, watched          | 45 ms | the same answer, from a file-system monitor  |
| `status`, watched and cached | 44 ms | the untracked walk remembered as well      |

Git ships both. Two lines, in the repository being scanned:

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
