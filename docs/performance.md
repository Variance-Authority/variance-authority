# What it costs to read your repository

Before a [Variance Authority](README.md) run can decide which **subjects** — a
subject is one named UI state you asked for and can ask for again — a change
could have reached, something has to read your repository: every module opened,
parsed, and every specifier in it resolved. It is the part of a run that grows
with your repository rather than with your suite, and a suite of any size pays
it once.

Reading a repository of a few hundred thousand files quickly is not one
problem. It is a sequence of them, and each one is created by the answer to the
last. A fast parser makes reading the bottleneck. Getting the reading off the
main thread makes the kernel the bottleneck. Widening the reads makes them
slower. Refusing to open files at all buys a subprocess you then have to earn
back. And a scan you only pay once is a scan whose answer you now have to store
and query, which is [its own page](scale.md).

This is that sequence, in the order it was met.

## A parser was never the problem

The first suspect on a job that reads 24.9 MB of TypeScript is the thing that
turns text into a tree. It is the wrong suspect, and one thread is enough to
show it:

| Doing only this, on one thread | Costs |
| --- | --- |
| read 24,519 files from disk | 321 ms |
| parse them with oxc | 155 ms |
| **read and parse, back to back** | **476 ms** |

[oxc](https://oxc.rs) parses every module in the checkout in 155 ms. Handing it
the files costs more than twice that, on the same thread, off a warm page
cache, with no syntax tree built and nothing resolved. Whatever else a scan
does, it cannot go below this pair, and the larger half of the pair is not
parsing.

That is the first wall, and everything below is what it takes to get under it.

## A tree per file is a tree that has to cross back

Parsing in 155 ms is only useful if nothing between the file and the parse
costs more than the parse. In JavaScript it does: every module's tree crosses
into the runtime, is allocated there, and is collected there, and that happens
24,519 times whatever the parser underneath is doing.

So the scanner is compiled, and it is the only part of Variance Authority that
had to be. Everything else in it is TypeScript and stays TypeScript, because
everything else is a decision about data — what changed, what it reached, what
to run, what to record — and a decision costs what it costs in any language.
This is not a decision. It is every file you have, and the only way to stop
paying the runtime for them is to stop handing them to it.

[Sense](../packages/sense) ships a Rust addon that opens, parses, resolves and
records a whole cold checkout without handing a syntax tree back to JavaScript
— oxc for the parse and for the resolver, [rayon](https://docs.rs/rayon) for
the pools whose widths the next three sections are spent arguing about, and one
arena per worker rather than one per file. It is not a rewrite: the TypeScript
scanner is still the implementation of record, the addon is held to its answers
by differential tests, and a machine with no binary for it builds the same
index and pays more for it. [Where the native code is](native-code.md) says
where that happens.

Plenty of compiled code runs under a scan — oxc's own bindings, libvips under
the screenshots — and all of the rest of it is somebody else's. Installing a
native library is cheap. Writing one is a platform matrix, a release that can arrive without a
binary, and a second implementation to keep honest, which is a bill worth
paying once and only where something forces it.

That is the premise of every measurement below, not their result. What it buys
is not a faster loop; it is a scan whose remaining cost is entirely somebody
else's. Once opening a file is the expensive part of reading a file, the
language the loop is written in has stopped being the question — and the
questions that are left all belong to the kernel.

## Opening the files in parallel makes them slower

Twenty-four thousand files is a great many files and almost no bytes, so the
move is to ask for them all at once. Nobody expects that to scale forever. What
everybody expects is the shape it stops in: an SSD serves many outstanding
requests at a time and wants depth to stay busy, so you add readers until the
device is saturated, callers begin queueing behind one another, and the curve
goes flat. The usual pool size — one reader per core — is a guess at where flat
begins.

It does not go flat. Past four readers it goes back up, and keeps going up.

Same files, same work, only the width moving. The width is the size of the
addon's read pool, and `packages/sense/scripts/read-width.mjs` is a driver that
calls into it — forty lines of JavaScript around `readBatch`, so what the table
prices is the Rust:

```text
width       ms     user ms   system ms   cores   kernel µs/file
    1    504.2        1294         506     3.6             18.2
    2    364.1        1268         642     5.2             23.1
    3    356.8        1086         851     5.4             30.7
    4    308.4        1108         966     6.7             34.8
    6    322.0        1044        1453     7.8             52.4
    8    342.4         954        1973     8.6             71.1
   12    455.6         901        4012    10.8            144.6
   16    481.1         828        4620    11.3            166.5
```

Read the first column against the last. User time does not rise: the parsing
and the extraction are the same work however many threads are opening files.
System time rises ninefold across the same 27,744 `open` calls, and the
per-file kernel cost rises with it, from 18.2 µs to 166.5 µs.

That last column is the finding, and it is what separates the two explanations.
A saturated device — one serving as fast as it can while callers queue — holds
the per-call cost flat: the wall clock stops improving because each caller
waits longer, not because each call costs more. Here the call itself gets more
expensive, sixteen threads paying nine times the kernel time of one for exactly
the same 27,744 `open` calls. The readers are not queueing behind the work.
They are making each other's work more expensive, because an `open` walks the
path under locks on directory vnodes and the name cache, and those locks are
shared.

Contention, not saturation. A saturated device is widened by a faster device.
This is not.

Two other readings are available and both are wrong. It is not the efficiency
cores — the machine these were taken on is twelve performance and four
efficiency, so an E-core explanation puts the cliff at twelve, and the
degradation starts before it while user time stays flat. It is not the scanner either, because ripgrep
collapses on the same curve on the same machine.

**Full-disk encryption is already in these numbers.** They were taken on a
FileVault volume, so every byte read above came back decrypted, and the next
section reads all 31.6 MiB of them for 34 ms on top of the opens — decryption
included, and still nothing beside what the opens cost. Encryption is a
per-byte cost down at the block layer, which is the half of this that is cheap.
BitLocker and LUKS sit in the same place.

**An endpoint security agent does not.** Falcon, Defender, any filter driver or
kernel extension that inspects file access is asked about an `open` before the
filesystem does its own work, and it is asked inside the contended path. That
makes it a multiplier on the thing that already costs everything rather than a
tax on the thing that costs nothing, and **your machine has more of it in that
path than that one did.** What it comes to is your image, your agent and your
policy, so the numbers above are not transferable and the sweep that produced
them is committed for exactly that reason — run it where the answer matters.
What an agent in the path changes is not mainly which width to pick. It is how
much a descriptor is worth not buying at all, which is where this ends up
anyway.

## The bytes are free; the descriptor is not

If the readers are making each other's work more expensive, the next question is
which part of the work. A read is a path walk, a descriptor and some bytes, and
only one of those three is worth attacking. Four probes over the same 27,744
files, at widths 1 through 16, each doing a little more than the last:

```
                 1        2        4        6        8       16
open+close     354      201      150      170      258      705
open+fstat     307      193      165      201      252      620
open+read      350      211      198      190      237      622
stat+open+read 365      222      179      189      232      599
```

`open` and `close`, touching no file data whatsoever, reproduce the entire
collapse. Reading all 31.6 MiB on top of that costs about 34 ms. Thirty
megabytes is nothing. Twenty-seven thousand `open` calls is everything.

Three things follow from that, and two of them killed an optimization that
looked obvious:

- **A second pathname resolution is free.** `stat` then `open` costs what `open`
  alone costs, because the second lookup finds the vnode the first one just
  cached.
- **Path depth is free.** `openat` from a directory descriptor opened once per
  directory, resolving one component instead of every component of every path,
  matches plain opens — 303 ms against 308.
- **Locality is worse.** Sorting reads by parent directory to get it is actively
  slower at the useful widths, because 1,161 directory groups are too uneven to
  balance.

Two more were tried and are not here. **`mimalloc`**: the profile was 98%
system time, so an allocator was never going to appear in it, and it did not.
**Per-file `mmap`**: it adds virtual-memory work to a process already bounded
by kernel-wide coordination, which is the same reason ripgrep's authors found
it loses on many small files.

What is left is concurrent `open` itself, and no arrangement of the same calls
avoids it.

## Reads and parses are not one width

Reading is bounded and parsing is not, so they are not run at one width. Reads
go in their own pool at a calibrated constant; parses run on the global pool at
machine width; and each chunk's reads overlap the last chunk's parses, so a
file is being opened while the previous batch is still being parsed.

That is close to the best a schedule can do. Acquiring those files costs
165 ms — the worktree row of the git table below — and parsing them costs 47 ms
once the parse is spread across the pool, so a schedule that hid one behind the
other perfectly would finish in about 170 ms and the measured 196 is near
enough that a channel-based rewrite has nothing to win. Chunk size was swept
for the same reason the widths were: 2,048 files per step wins at 201 ms
best-of-five and 128 loses at 349, because a step short enough to pipeline
finely is short enough that the readers spend it starting and stopping.

**Both widths belong to the machine, and both are constants that should not
be.** The read width is the filesystem's answer, and four to six is what APFS
admitted there — the sweep above bottoms out at four reading alone, the shipped
constant is six, and the useful claim is the range rather than either end of it.
ext4 and XFS admit more; an overlay filesystem in a container, or anything over
a network, usually admits fewer. The parse width is the performance
core count's, and on a large machine it is the larger lever of the two: over a
306,694-file scan on an M4 Pro — ten performance cores, four efficiency — four
parser threads finish in 8.8 s where fourteen take 10.9, and spend a third less
CPU doing it. The arithmetic accounts for it: six readers plus fourteen parsers
is twenty runnable workers asking for ten fast cores, and the overflow lands on
the efficiency ones.

Neither number is a property of the binary, and no package manager can tell
those machines apart: `os`, `cpu` and `libc` are the only keys it has, and none
of them says how many performance cores are behind it. So the width is an
argument on every batch entry point, and `read-width.mjs` is committed, so a
guess made on one machine can be replaced with a measurement in one command on
the machine that has to live with it.

## Then stop opening the file

If a descriptor costs what nobody can widen — and costs more than that on a
machine with an agent in the path — the remaining move is not to buy one.

Git already holds the bytes of every tracked file, addressed by content, in a
packfile. `cat-file --batch` opens that pack once per process, and every object
after that is a seek and an inflate: no path walk, no name cache, no vnode lock
shared with five other readers, and nothing for a filter driver to intercept.

Repository size decides this, and it decides it in opposite directions.

| reading the same tracked files | from the worktree | from the pack |
| --- | --- | --- |
| 27,744 modules, 31.6 MiB | 165 ms | 204 ms |
| 200,000 blobs | 6.4 s wall, 76 s system | 0.66 s wall, 0.32 s system |

On a small checkout the pipe costs more than the descriptors it saves, and a
worktree read wins outright. An order of magnitude up, the same comparison is
ten times the wall clock and two hundred times the kernel time, because what
grows between those two rows is exactly what git does not pay. A repository
large enough to make this question worth asking is a repository where the
answer is git.

The second row was falsified against a 20,000-file incompressible tree, so
delta compression is not what produced it. Of that 0.66 s, `--batch-check` —
object lookup with no content at all — is 0.21 s, leaving 0.23 s of inflate and
0.37 s of system time that is almost entirely 67 MB crossing a pipe.

So both paths ship and the size of the wave picks between them. Starting a
`cat-file` process costs 7.08 ms there; a blob saves about 53 µs against an
open; the two divide to about 134 files, and `FILES_PER_PROCESS = 160` rounds
it up rather than down, because a bucket that only just clears the line saves
nothing worth a process. A wave below it reads from disk, where the chunked
pipeline overlaps the next open with the current parse. Both give the same
answers.

Nothing changes for dirty or untracked files. Those are hashed with
`hash-object`, which does not write the object, so `cat-file` answers `missing`
and the read falls back to opening the file — the path every other failure
already used.

The two paths are shaped differently because the thing they are hiding is
different. A worktree read is waiting on a descriptor, so it has a bounded read
pool in front of a wide parse pool with the two overlapped. A pack read is not
waiting on anything worth hiding, so each stream reads its blob and parses it
before asking for the next, and the stream count is the only width there is.

On a mid-sized subtree where both paths are viable, the pack takes a cold scan
from 582 ms to 473 and drops its kernel half by forty percent.

That is the end of the cold path, and it is worth putting next to where it
started. One thread reading and parsing these files, doing nothing else, costs
476 ms. A cold scan of the same checkout — every file read, every tree built,
every specifier resolved, every declaration indexed and the index written —
costs **586 ms**. Everything the scan does above that floor — which is
everything that makes it a scan rather than a read — fits in 110 ms, and it only
fits there because almost none of it is spent acquiring anything.

## After the first read, you do not read it again

Everything above is the cold path, and you pay it on a fresh clone and on a CI
runner with nothing cached. Every run after it opens an incremental,
content-addressed index instead: an unchanged run reuses it, edits rebuild
changed records, and a path appearing invalidates only the records whose
specifiers could have named the directory it appeared in.

Each row below is a working tree put into that shape and then put back. The
last two columns are counted rather than inferred: a record is either reused or
rebuilt, and a rebuild either opens the file or answers from the parse cache,
which is keyed by content and by what the file's name said about reading it.

| The tree is | Total | Records rebuilt | Files opened |
| --- | --- | --- | --- |
| new — no index at all | 586 ms | 24,908 | 78 |
| unchanged since last run | 301 ms | 1 | 0 |
| four files edited | 320 ms | 5 | 4 |
| five hundred files edited | 385 ms | 501 | 500 |
| one file added | 362 ms | 105 | 104 |
| a hundred in, a hundred out, five hundred edited | 556 ms | 1,079 | 1,078 |

**An edit costs per file, over a fixed toll.** Five hundred files edited cost
about 65 ms more than four did — roughly an eighth of a millisecond each, which
is a file read, parsed and resolved. The 300 ms underneath is charged whether
anything changed or not, and a third of it is git. The rest is the walk —
every path in the repository visited and checked against its digest to decide
not to do anything about it — plus the index decoded so that there is something
to check it against. Both are proportional to the repository rather than to the
diff.

**A path appearing costs the directory it appeared in.** One file added rebuilds
105 records, because a record's edges depend on the bytes of the file, on how
resolution is configured, and on the membership of the directories its own
specifiers could have been answered from — nothing else. A hundred added, a
hundred removed and five hundred edited touch more directories and so rebuild
1,079: the 500 the edit is worth, plus the neighbours of the two hundred paths
that moved. The work tracks the diff rather than the repository.

**That 105 is one directory's answer, and the distribution is the claim.** The
cost of an appearance is the number of records watching the directory it
appeared in, so the whole shape is reported rather than one row of it. Over the
checkout below, 1,493 directories, 506 of them watched by anything, and a record
watches 1.3 directories on average. The table reads the other direction — how
many records watch one directory, which is what an appearance costs — and that
direction is skewed enough that its mean would tell you nothing:

| One path appears in a directory, and it rebuilds | Records |
| --- | --- |
| the median directory | 7 |
| the 90th percentile | 36 |
| the 99th percentile | 242 |
| the worst directory in that checkout | 21,500 |

The worst directory there is `packages/mui-icons-material/lib/utils`, home to
the one module that 21,506 generated icons import. Every one of them genuinely
depends on what that directory contains, so every one of them is rebuilt when
its membership changes — which is to say a regeneration of the icons costs what
a cold run costs, and nothing else in that checkout does. Expect the same
wherever a barrel sits under a generated directory.

One repository shape removes that bound: a `tsconfig` that cannot be read. A
bare specifier is bounded by the `paths` a configuration declares, so a
configuration that cannot be parsed is no bound at all, and there every added
path invalidates every record. The symptom is a warm run that costs what a cold
one does.

### Where the third of a second is

Of a warm run's 301 ms, roughly 116 is decoding the index, 185 is the scan, and
nothing at all is publishing — an unchanged tree has no segment to append. The
scan is two things and neither is a parse: git answering what the working tree
looks like, and about 92 ms of the scanner's own — every record in the index
walked and each checked against its digest. Which of the two is
larger is decided by the accelerators below.

The publish is the smallest of the three because of how little it writes. A run
that changed nothing writes nothing — the index is an append-only chain of
immutable segments, and an unchanged run has no segment to append. A run that
edited four files appends about **14,000 bytes** to a 10.5 MB index. The whole
of it is re-encoded only when the chain has grown past eight segments, which is
one publish in eight and costs about 150 ms more than an append.

### git, and the two accelerators

Everything Variance Authority knows about a working tree comes from git.
`ls-tree` reads the commit and does not grow with the checkout. `status` reads
the working tree and does, so it is the row that matters, and git ships two
accelerators for it that are off by default:

```bash
git config core.fsmonitor true
git config core.untrackedCache true
```

| Asking git for `status` | Costs |
| --- | --- |
| neither accelerator | 93 ms |
| `core.fsmonitor` | 54 ms |
| both | 52 ms |

The monitor answers for tracked files. The untracked cache answers the other
half of the same question — what is on disk that the index has never heard of —
and it does not move this row, because these figures are taken on a clean
checkout and the walk it spares finds nothing. On a working tree with build
output in it, that is the half that costs.

Nothing here turns either of them on for you. Starting a file-system daemon on
somebody's repository is not a scanner's decision, so the repository's own
configuration decides, and the two lines above are how you make it.

The monitor can be wrong after a crash, on a network filesystem, and across a
container boundary. When it is, git recomputes.

## The same wall, in somebody else’s program

Everything above turns on one claim: that what a scan of this shape costs is
acquisition, and that acquisition degrades with width for reasons that have
nothing to do with the scanner. ripgrep is the way to check that without taking
any of it on trust. It walks a repository's source files, opens
every one, reads all of its bytes and reduces them to something much smaller.
That is the same shape as this scan, minus the part that makes a scan useful:
ripgrep runs a literal search, and this builds a syntax tree and extracts every
specifier out of it. ripgrep is doing far less work per byte, and far more
attention has been paid to it doing that work fast. It is also Rust over the
same kind of work-stealing pool, which is what makes the comparison worth
printing at all: the two sides differ in what they do per byte, not in what
they are written in.

A claim about the kernel should be reproducible in a program that shares none
of the scanner's decisions, and `packages/sense/scripts/scan-cost.mjs` runs both
over the same files at the same widths. The pattern ripgrep is given never
matches, which is its best case — the literal prefilter rejects each buffer
without the regex engine ever starting — so what is left on its side is
acquisition, which is the thing being compared.

```
threads          ripgrep: open, read, search   sense: open, read, parse, extract
                  ms        user      system          ms        user      system
1              420.0       30 ms      390 ms       446.9      101 ms      346 ms
2              250.0       40 ms      450 ms       237.5      120 ms      416 ms
4              190.0       50 ms      680 ms       224.4      141 ms      803 ms
6              190.0       50 ms     1050 ms       196.2      154 ms     1071 ms
8              220.0       60 ms     1700 ms       216.6      186 ms     1645 ms
16             530.0       80 ms     7230 ms       374.3      203 ms     4828 ms
```

Two curves, one shape. Both bottom out in the middle, both climb again, and
both spend almost everything they spend in the kernel. At the shared minimum
the two are the same speed — 196 against 190 — and one of them is also parsing
TypeScript.

What that table is here for is the shape, not the winner. A program with no
resolver, no tree and no index collapses at width on the same machine, which is
the evidence that the collapse belongs to the machine. The speeds being close
is the smaller point, and they are close at one width rather than at all of
them: sense is 18% behind at four threads and ahead at sixteen. What holds
across every row is where the time goes — parsing is the 154 ms of **user**
time, and user time is not what any of these rows cost.

## What these were measured on

Every millisecond above was taken on an Apple M4 Max (Mac16,9) — 12 performance
cores, 4 efficiency, 64 GB, macOS 27.0 on arm64, Node v26.7.0, Yarn 4.18.0,
ripgrep 15.2.0 — on a local SSD with a warm filesystem cache, except the
306,694-file scan, which is stamped with the M4 Pro it was taken on. A warm
cache makes these the fast end of the range and a floor rather than a budget:
size a CI container above them, not against them.

The repository is one this project did not write: [Material
UI](https://github.com/mui/material-ui) at `8f19b1009b`, 41,171 tracked paths,
of which 24,519 are modules and 24.9 MB is source. A cold scan of it rebuilds
24,908 records. It is public and it is pinned, so every figure here is one you
can take yourself.

**Three counts of it appear above and they are not the same count.** 24,519 is
the module files git lists, and it is what the floor table is charged per.
24,908 is the records a cold scan **rebuilt**, which is more than the module
files because the walk also records stylesheets and declaration files that the
module listing excludes — it is not the number of records the index ends up
holding, which is counted where the index is
[sized](source-index.md#how-large-it-gets). 78 is how many of those rebuilds opened a
file: the cold scan reads the rest out of the packfile, which is the whole
point of the section that argues for it. 27,744 is the ripgrep
comparison's file set, which is what both programs were pointed at.

The git rows, the floor rows and the cold scan are each the median of five
timings. **Every other row of the incremental table is one timing of one run.**
Read that column for its shape and not for a difference of a few tens of
milliseconds; a single sample is worth about that much either way.

Every figure comes from a committed script, run against a clone of that
checkout: `source-index.mjs` for the incremental and floor tables,
`scan-cost.mjs` for ripgrep, `read-width.mjs` for the width sweep, all under
`packages/sense/scripts`.

Material UI is not a large repository, and none of the trees measured above
are. What these rows come to on a checkout of a serious size — and what the
index and the [execution record](execution-record.md) weigh there — is in
[addressing scale](scale.md).