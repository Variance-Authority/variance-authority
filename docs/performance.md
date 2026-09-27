# What it costs to read your repository

Before a [Variance Authority](README.md) run can decide which **subjects** — a
subject is one named UI state you asked for and can ask for again — a change
could have reached, something has to read your repository: every module opened,
parsed, and every specifier in it resolved. It is the part of a run that grows
with your repository rather than with your suite, and a suite of any size pays
it once.

Reading a repository of a few hundred thousand files quickly is not one
problem. It is a sequence of them, and each one is created by the answer to the
last:

- A fast parser makes reading the bottleneck.
- **Reading a file from JavaScript costs seven times what reading it from Rust
  does**, so the stage gets compiled.
- Getting the reading off the main thread makes the kernel the bottleneck.
- Widening the reads makes them slower.
- Refusing to open files at all buys a subprocess you then have to earn back.
- **A scan you only pay once is a scan whose answer you now have to store and
  query**, which is [its own page](scale.md).

This is that sequence, in the order it was met. Almost every figure in it was
measured on an M4 Max with twelve performance cores, four efficiency cores and a
warm filesystem cache, over two repositories this project did not write. Both
are public and pinned: [Material UI](https://github.com/mui/material-ui) at
`8f19b1009b`, and [Kibana](https://github.com/elastic/kibana) at `df0daaddcc`.
Kibana has about four times as many modules as Material UI, 105,900 against
24,519 in the first table below, and its average module is about four times the
size, 4.4 KB against 1.0 KB. The
two figures that come from somewhere else say so where they appear. [The closing
section](#what-these-were-measured-on) is the full stamp, and it is also where
the different counts of each repository are reconciled, because the tables below
are not all charged per the same one.

## A parser was never the problem

The first suspect on a job that reads 24.9 MB of TypeScript is the thing that
turns text into a tree. It is the wrong suspect, and one thread is enough to
show it:

| Doing only this, on one thread | Material UI, 24,519 files | Kibana, 105,900 files |
| --- | ---: | ---: |
| read them from disk | 321 ms | 2,148 ms |
| parse them with oxc | 155 ms | 3,336 ms |
| **read and parse, back to back** | **476 ms** | **5,484 ms** |

```mermaid
xychart-beta horizontal
  accTitle: Milliseconds on one thread for Material UI's 24,519 modules
  x-axis ["parse them with oxc", "read them from disk"]
  y-axis "milliseconds" 0 --> 350
  bar [155, 0]
  bar [0, 321]
  bar [0, 0]
  bar [0, 0]
```

```mermaid
xychart-beta horizontal
  accTitle: Milliseconds on one thread for Kibana's 105,900 modules
  x-axis ["parse them with oxc", "read them from disk"]
  y-axis "milliseconds" 0 --> 3500
  bar [3336, 0]
  bar [0, 2148]
  bar [0, 0]
  bar [0, 0]
```

[oxc](https://oxc.rs) parses every module in the checkout in 155 ms. Handing it
the files costs more than twice that, on the same thread, off a warm page
cache, with no syntax tree built and nothing resolved. Whatever else a scan
does, it cannot go below this pair, and the larger half of the pair is not
parsing.

On Kibana the larger half is the parse: 3,336 ms against 2,148 ms of reading.
Per file, the parse costs about five times what it costs on Material UI, 31.5 µs
against 6.3 µs, and the read costs about half as much again, 20.3 µs against
13.1 µs. Kibana's modules average 4.4 KB against Material UI's 1.0 KB, so each
file has about four times the bytes: the parse cost per file rises about as much
as the bytes do, and the read cost does not. Across these two repositories, the
one with larger files spends more of the read-and-parse pair in the parser.

That is the first wall, and everything below is what it takes to get under it.

## A tree per file is a tree that has to cross back

Parsing in 155 ms is only useful if nothing between the file and the parse
costs more than the parse. In JavaScript it does, and the same files say by how
much. Doing the whole stage — read every module, parse it, pull every specifier
out of the tree — over 27,748 of them costs **1,997 ms** written in TypeScript
and **276 ms** written in Rust. Both sides are given the same file list in the
same order and both are made to produce the same 101,655 specifiers, compared
element by element, before either time is printed; a run whose two sides
disagree prints no time at all.

```mermaid
xychart-beta horizontal
  accTitle: Milliseconds to read, parse and extract specifiers from 27,748 modules
  x-axis ["written in Rust", "written in TypeScript"]
  y-axis "milliseconds" 0 --> 2000
  bar [276, 0]
  bar [0, 1997]
  bar [0, 0]
  bar [0, 0]
```

Seven times is not a parser gap, because there is no parser gap: oxc does the
parsing on both sides. What the slow side is paying for is the tree arriving.
Every module's syntax tree is built in the runtime's heap, walked from
JavaScript to find the specifiers, and collected there — 27,748 times, against
155 ms of actual parsing. And it cannot be spread out of the way, because the
walk is the thing allocating: the TypeScript stage holds 1.23 cores of a
sixteen-core machine while the addon holds 7.74.

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
arena per worker rather than one per file, because a tree that never leaves the
worker that built it can be thrown away by resetting a bump pointer instead of
by being allocated and torn down twenty-seven thousand times. It is not a rewrite: the TypeScript
scanner is still the implementation of record, and the addon is held to its
answers by differential tests. The addon is also the only writer of the index,
so a machine with no binary for it gets no index rather than a slower one.
[Where the native code is](native-code.md) says where that happens.

Plenty of compiled code runs under a scan — oxc's own bindings, libvips under
the screenshots — and all of the rest of it is somebody else's. Installing a
native library is cheap. Writing one is a platform matrix, a release that can arrive without a
binary, and a second implementation to keep honest, which is a bill worth
paying once and only where something forces it.

Those two numbers are where every measurement below starts. What the second one
buys is not a faster loop; it is a scan whose remaining cost is entirely
somebody else's. Once opening a file is the expensive part of reading a file, the
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
addon's read pool — the parse pool stays at machine width in every row, so the
only thing changing is how many threads are inside the filesystem at once.
`packages/sense/scripts/read-width.mjs` is a driver that calls into it, forty
lines of JavaScript around `readBatch`, so what the table prices is the Rust:

| Readers | Material UI wall | Material UI system | Material UI kernel µs per file | Kibana wall | Kibana system | Kibana kernel µs per file |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 449.6 ms | 459 ms | 16.5 | 2,792.5 ms | 2,455 ms | 23.0 |
| 2 | 310.9 ms | 555 ms | 20.0 | 2,130.2 ms | 3,123 ms | 29.2 |
| 3 | 301.3 ms | 732 ms | 26.4 | 2,053.4 ms | 4,215 ms | 39.4 |
| 4 | 280.7 ms | 860 ms | 31.0 | **1,947.8 ms** | 4,882 ms | 45.6 |
| 6 | **271.4 ms** | 1,188 ms | 42.8 | 1,971.9 ms | 6,831 ms | 63.9 |
| 8 | 281.3 ms | 1,650 ms | 59.5 | 2,119.9 ms | 9,634 ms | 90.1 |
| 12 | 398.6 ms | 3,635 ms | 131.0 | 2,658.9 ms | 18,675 ms | 174.6 |
| 16 | 480.8 ms | 5,293 ms | 190.8 | 2,864.5 ms | 24,721 ms | 231.1 |

Read the readers against the kernel cost. On Material UI, system time rises
elevenfold across the same 27,748 `open` calls — not more calls, the same ones —
and the per-file kernel cost rises with it, from 16.5 µs to 190.8 µs. On Kibana
system time rises tenfold across its 106,971 `open` calls, from 2,455 ms to
24,721 ms, and the per-file kernel cost with it, from 23.0 µs to 231.1 µs. At
every width a Kibana file costs the kernel more than a Material UI file does.

Drawn, Material UI's wall clock bottoms out at six readers and Kibana's at four:

```mermaid
xychart-beta
  accTitle: Wall milliseconds to read Material UI's 27,748 files, by number of readers
  x-axis "readers" ["1", "2", "3", "4", "6", "8", "12", "16"]
  y-axis "milliseconds" 0 --> 500
  line [449.6, 310.9, 301.3, 280.7, 271.4, 281.3, 398.6, 480.8]
```

```mermaid
xychart-beta
  accTitle: Wall milliseconds to read Kibana's 106,971 files, by number of readers
  x-axis "readers" ["1", "2", "3", "4", "6", "8", "12", "16"]
  y-axis "milliseconds" 0 --> 3000
  line [2792.5, 2130.2, 2053.4, 1947.8, 1971.9, 2119.9, 2658.9, 2864.5]
```

What the kernel spends on one file climbs the whole way on both, Material UI in
orange and Kibana in grey:

```mermaid
xychart-beta
  accTitle: Kernel microseconds per file for Material UI and Kibana, by number of readers
  x-axis "readers" ["1", "2", "3", "4", "6", "8", "12", "16"]
  y-axis "microseconds" 0 --> 250
  line [16.5, 20.0, 26.4, 31.0, 42.8, 59.5, 131.0, 190.8]
  line [23.0, 29.2, 39.4, 45.6, 63.9, 90.1, 174.6, 231.1]
```

The kernel column is the finding, and it is what separates the two explanations.
A saturated device — one serving as fast as it can while callers queue — holds
the per-call cost flat: the wall clock stops improving because each caller
waits longer, not because each call costs more. Here the call itself gets more
expensive, sixteen threads paying eleven times the kernel time of one for
exactly the same 27,748 `open` calls. The readers are not queueing behind the work.
They are making each other's work more expensive, because an `open` walks the
path under locks on directory vnodes and the name cache, and those locks are
shared.

Contention, not saturation. A saturated device is widened by a faster device.
This is not.

Two other readings are available and both are wrong. It is not the efficiency
cores — the machine these were taken on is twelve performance and four
efficiency, so an E-core explanation puts the cliff at twelve, and the
degradation starts at eight on Material UI and at six on Kibana, well before it. It is not the scanner either:
ripgrep has no parser, no resolver and no index, and [collapses on the same
curve on the same machine](#the-same-wall-in-somebody-elses-program) — where
its user time, which is its actual searching, holds at 30 to 80 ms while its
system time goes up twentyfold.

**Full-disk encryption is already in these numbers.** They were taken on a
FileVault volume, so every byte read above came back decrypted, and the next
section fails to find the cost of reading all 30.3 MiB of them at all —
decryption included — underneath what the opens cost. Encryption is a
per-byte cost down at the block layer, which is the half of this that is cheap.
BitLocker and LUKS sit in the same place.

**An endpoint security agent does not.** Falcon, Defender, any filter driver or
kernel extension that inspects file access is asked about an `open` before the
filesystem does its own work, and it is asked inside the contended path. That
makes it a multiplier on the thing that already costs everything rather than a
tax on the thing that costs nothing, and **a managed machine or a CI image has
more of it in that path than that one did.** What it comes to is your image, your agent and your
policy, so the numbers above are not transferable and the sweep that produced
them is committed for exactly that reason — run it where the answer matters.
What an agent in the path changes is not mainly which width to pick. It is how
much a descriptor is worth not buying at all, which is where this ends up
anyway.

## The bytes are free; the descriptor is not

If the readers are making each other's work more expensive, the next question is
which part of the work. A read is a path walk, a descriptor and some bytes, and
only one of those three is worth attacking. Four probes over the same 27,748
files, and over Kibana's 106,971, at widths 1 through 16, each doing a little
more than the last:

| Milliseconds, at width | 1 | 2 | 4 | 6 | 8 | 16 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Material UI, `open` then `close` | 354 | 201 | 150 | 170 | 258 | 705 |
| Material UI, `open` then `fstat` | 307 | 193 | 165 | 201 | 252 | 620 |
| Material UI, `open` then `read` | 350 | 211 | 198 | 190 | 237 | 622 |
| Material UI, `stat`, then `open` then `read` | 365 | 222 | 179 | 189 | 232 | 599 |
| Kibana, `open` then `close` | 1,817.7 | 1,123.7 | 1,129.3 | 1,298.2 | 1,968.2 | 3,908.8 |
| Kibana, `open` then `fstat` | 1,842.9 | 1,138.4 | 1,048.1 | 1,280.6 | 1,996.9 | 3,886.5 |
| Kibana, `open` then `read` | 1,941.0 | 1,185.3 | 1,154.0 | 1,293.6 | 1,966.3 | 3,862.5 |
| Kibana, `stat`, then `open` then `read` | 2,069.7 | 1,248.0 | 1,160.7 | 1,260.6 | 2,009.7 | 3,758.4 |

`open` and `close`, touching no file data whatsoever, reproduce the entire
collapse. Read the second row against the third and try to find the bytes in
it: adding a full read of all 30.3 MiB moves the probe by less than the probe
moves between runs, and at three of the six widths the version that reads every
byte finishes *ahead* of the version that opens the file and immediately closes
it. Thirty megabytes is not a small cost here. It is a cost that does not
survive the noise of the thing it is sitting on top of, and twenty-seven
thousand `open` calls is that thing.

Kibana has nearly fifteen times Material UI's bytes, 446.0 MiB. At one, two and
four threads, reading all of them costs 6.8%, 5.5% and 2.2% more than opening
and closing the same files. At the other three of the six widths, six, eight and
sixteen, the version that reads every byte finishes ahead, by 0.4%, 0.1% and
1.2%.

`open` then `read` and `open` then `close` drawn for each repository, the first
in orange and the second in grey, Material UI first:

```mermaid
xychart-beta
  accTitle: Milliseconds for open then read, and open then close, over Material UI's files, by number of threads
  x-axis "threads" ["1", "2", "4", "6", "8", "16"]
  y-axis "milliseconds" 0 --> 750
  line [350, 211, 198, 190, 237, 622]
  line [354, 201, 150, 170, 258, 705]
```

```mermaid
xychart-beta
  accTitle: Milliseconds for open then read, and open then close, over Kibana's files, by number of threads
  x-axis "threads" ["1", "2", "4", "6", "8", "16"]
  y-axis "milliseconds" 0 --> 4000
  line [1941.0, 1185.3, 1154.0, 1293.6, 1966.3, 3862.5]
  line [1817.7, 1123.7, 1129.3, 1298.2, 1968.2, 3908.8]
```

The same probes give three more findings. The last two are optimizations that
look obvious, and neither is worth shipping:

- **A second pathname resolution is free.** `stat` then `open` costs what `open`
  alone costs, because the second lookup finds the vnode the first one just
  cached.
- **Path depth is free.** `openat` from a directory descriptor opened once per
  directory, resolving one component instead of every component of every path,
  matches plain opens measured beside it in the same run — 303 ms against 308.
  On Kibana it loses to plain opens at every width, by 14% to 30%. Kibana's
  106,971 files sit in 23,759 directories, one for every 4.5 files, so `openat`
  makes 22% more `open` calls there than plain opens do, one extra for each
  directory's descriptor. Material UI's 27,748 files sit in 1,161 directories,
  4% more calls.
- **Sorting by directory is worth at most 5%.** Sorting reads by parent
  directory, so that threads share a vnode instead of colliding over one, lost
  on Material UI at every width worth using: the checkout's 1,161 directory
  groups are uneven enough that the sort buys stragglers rather than locality.
  On Kibana the same sort wins by 0.2%, 5.0% and 1.2% at two, four and six
  readers, and loses by 1.3%, 3.0% and 0.1% at one, eight and sixteen.

Two more were tried and are not here. **`mimalloc`**: the table above spends
nearly all of itself in the kernel, so an allocator was never going to appear
in it, and it did not.
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

That is close to the best a schedule can do, and the way to see it is to price
the half that cannot be hidden. Acquiring those files costs 165 ms — the
worktree row of the git table below. The whole stage, acquisition and parsing
and extraction together, costs 218 ms at the same width — the sense column of
the ripgrep table further down. So everything that is not acquisition fits in
53 ms, over files whose parse alone is 155 ms on one thread. Most of the parse
is already happening inside the reads, which is what the overlap is for, and a
schedule that hid the rest of it perfectly could take back 53 ms at the
outside, so on Material UI a channel-based rewrite has nothing to win. On Kibana
the same two rows leave 269.5 ms, 1,543.8 against 1,274.3, over files whose
parse alone is 3,336 ms on one thread. That is about 17% of the 1,543.8 ms
stage, and it is the most a better schedule could take back there. Chunk size
was swept for the same reason the widths were: 2,048 files per step wins at
201 ms and 128 loses at 349, because a step short enough to pipeline finely is
short enough that the readers spend it starting and stopping. On Kibana 8,192
files per step wins, at 1,882.8 ms, and 128 loses, at 2,408.0; every step from
2,048 to 8,192 finishes within 3.0% of the others.

**Both widths belong to the machine, and both are constants that should not
be.** The read width is the filesystem's answer, and four to six is what APFS
admitted there — the sweep above bottoms out at six, which is the shipped
constant, but four and eight are within four percent of it and twelve is half
again worse, so the range is the finding and the exact winner is not. Kibana's
sweep bottoms out at four, with six 1.2% behind, inside the same range.
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

Git already holds the bytes of every tracked file, addressed by content, in its
object store — packed, for everything that arrived with the clone.

So stop asking the filesystem for them and ask git.

The address is already in hand. A scan takes its digests from `ls-tree` — a
blob's name is the hash of its contents, which is what spares it hashing the
repository itself — and that name is also where the bytes sit in the pack. The
key carried to decide whether a file needs reading is the key that fetches it.
Every `open` in the sections above took the long way round to bytes that a
process one pipe away had indexed under an id the scan was already holding.

`cat-file --batch` opens that pack once per process, and every object after
that is a seek and an inflate: no path walk, no name cache, no vnode lock
shared with five other readers, and nothing for a filter driver to intercept.
Objects written since the last repack are loose rather than packed and cost one
open each, which is the worktree price for the handful of files that have it —
the same command answers for both and the caller never learns which it got.

Repository size decides this, and it decides it in opposite directions.

| reading the same tracked files | from the worktree | from the pack |
| --- | --- | --- |
| Material UI — 27,748 modules, 30.3 MiB | 165 ms, six readers | 204 ms, one `cat-file` stream |
| Kibana — 106,971 modules, 446.0 MiB | 1,274.3 ms wall, 7,584.4 ms system, six readers | 208.86 ms wall, 353.5 ms system, six `cat-file` streams |
| a generated repository — 200,000 blobs | 6.4 s wall, 76 s system | 660 ms wall, 320 ms system |

On a small checkout the pipe costs more than the descriptors it saves, and a
worktree read wins outright. On Kibana, with four times the modules, the pack
wins: it reads the same files in about a sixth of the wall clock and a
twenty-first of the kernel time. An order of magnitude up from Material UI, the
same comparison is ten times the wall clock and two hundred times the kernel
time, because what grows between the first row and the last is exactly what git
does not pay. A repository large enough to make this question worth asking is a
repository where the answer is git.

The last row is a repository nobody wrote, and a generated tree is the kind of
thing that flatters a packfile: two hundred thousand similar files
delta-compress beautifully. So it was run again against a 20,000-file
incompressible tree, where they cannot, and the ratio survived — delta
compression is not what produces that row. Of the 660 ms, `--batch-check` —
object lookup with no content at all — is 210 ms, leaving 230 ms of inflate and
370 ms of system time that is almost entirely 67 MB crossing a pipe. Kibana is a
real repository, and one `cat-file` stream on its own reads all of its module
blobs in 1,024.75 ms, ahead of the 1,274.3 ms six readers take to open and read
the same files; lookup with no content is 120.99 ms of that.

So both paths ship, and what picks between them is the size of the wave — one
wave being however many files a scan has decided it needs at once, which is
every module in the repository on a cold run and a handful on a warm one.
On Material UI, starting a `cat-file` process costs 7.08 ms and a blob saves
about 53 µs against an open; the two divide to about 134 files, and
`FILES_PER_PROCESS = 160` rounds it up rather than down, because a bucket that
only just clears the line saves nothing worth a process. On Kibana a process
costs 8.48 ms to start, and at the same 53 µs a blob the two divide to 160 files,
which is the constant as it stands. A wave below 160 files reads from disk,
where the chunked pipeline overlaps the next open with the current parse. Both
give the same answers, and the number is worth remembering for the incremental
table below, where every wave is smaller than it.

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
from 582 ms to 473 and drops its kernel half by forty percent. On the whole of
Kibana it takes a cold scan from 7,945.7 ms to 7,723.9 and its system time from
8,896.9 ms to 2,507.4: 72% less kernel time for 3% less wall clock. Those two
Kibana scans come from a build of the addon forced onto one path for every
wave, each the median of three. The shipped scan picks its path by wave size,
and its cold scan is the 6,344 ms below, the median of three runs taken apart
from those two: read the forced builds against each other, not against it.

That is the end of the cold path, and it is worth putting next to where it
started. One thread reading and parsing these files, doing nothing else, costs
476 ms. A cold scan of the same checkout — every file read, every tree built,
every specifier resolved, every declaration indexed and the index written —
costs **586 ms**.

The right reading of those two numbers is not that the scan adds 110 ms of work
on top of the read. It is that the scan does not do the read. The 476 ms is
what the obvious route to the bytes costs, and the whole argument above is the
scan getting off that route: it does not pay 321 ms of opens, because it barely
opens anything. Six times the work for 23% more time is not a tight loop. It is
a different road.

On Kibana the cold scan costs **6,344 ms**, 16% above the 5,484 ms that one
thread takes to read and parse the same files. Reading and parsing are not what
makes up that time: at six threads, reading, parsing and extracting every file
costs 1,543.8 ms, in the ripgrep table below. In a profiled cold run, 5,582 ms
of the 6,757 ms sampled is one native call, the one that reads, parses and
resolves the whole module closure. Against 1,543.8 ms, that leaves about four
seconds of the call for resolving specifiers and walking the closure.

## After the first read, you do not read it again

Everything above is the cold path, and you pay it on a fresh clone and on a CI
runner with nothing cached. Every run after it opens an incremental,
content-addressed index instead. What that index holds is one **record** per
file — the file's digest, every specifier found in it, what each one resolved
to, and which directories could have answered them — so an unchanged run reuses
its records whole, an edit rebuilds the records of the files that changed, and a
path appearing invalidates only the records whose specifiers could have named
the directory it appeared in.

Each row below is a working tree put into that shape and then put back. The last
two columns are counted on the run rather than inferred from it: a record is
either reused or rebuilt, and a rebuild either goes back to the file's bytes or
answers from the parse cache, which is keyed by content and by what the file's
name said about reading it.

| The tree is | Material UI total | Material UI records rebuilt | Material UI re-read | Kibana total | Kibana records rebuilt | Kibana re-read |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| new — no index at all | 586 ms | 24,908 | 78 | 6,344 ms | 106,215 | 265 |
| unchanged since last run | 301 ms | 1 | 0 | 2,117 ms | 0 | 0 |
| four files edited | 320 ms | 5 | 4 | 2,355 ms | 4 | 4 |
| five hundred files edited | 385 ms | 501 | 500 | 2,575 ms | 500 | 500 |
| one file added | 362 ms | 105 | 104 | 2,468 ms | 111 | 111 |
| a hundred in, a hundred out, five hundred edited | 556 ms | 1,079 | 1,078 | 3,187 ms | 717 | 717 |

The re-read columns are warm-run measurements and the cold row is not
comparable in them: the native batch reads and parses inside itself, so its
24,908 rebuilds are invisible to a counter sitting on the scanner's own read
path, and the 78 is whatever that path picked up afterwards, as Kibana's 265 is.
On the warm rows of both checkouts they count everything.

**Every warm row reads from the worktree, not the pack.** A hundred and four
files re-read is a wave of a hundred and four, which is below the 160 the
section above spends a paragraph deriving, so it takes the disk path — and the
files in these waves are the ones that just changed, which git has no object
for until somebody commits them. The pack is the cold path's answer. The warm
path's answer is that there are four files.

**An edit costs per file, over a fixed toll.** Five hundred files edited cost
about 65 ms more than four did — roughly an eighth of a millisecond each, which
is a file read, parsed and resolved. The 300 ms underneath is charged whether
anything changed or not, and a third of it is git. The rest is the walk —
every path in the repository visited and checked against its digest to decide
not to do anything about it — plus the index decoded so that there is something
to check it against. Both are proportional to the repository rather than to the
diff. On Kibana the toll is over two seconds and more than half of it is
decoding the index. Five hundred files edited there cost about 220 ms more than
four did, 2,575 ms against 2,355, but the four-file row's three timings span
2,277 ms to 2,584, wider than that difference. On Kibana those two rows do not
price an edit.

**A path appearing costs the directory it appeared in.** One file added rebuilds
105 records, because a record's edges depend on the bytes of the file, on how
resolution is configured, and on the membership of the directories its own
specifiers could have been answered from — nothing else. A hundred added, a
hundred removed and five hundred edited touch more directories and so rebuild
1,079: the 500 the edit is worth, plus the neighbours of the two hundred paths
that moved. The work tracks the diff rather than the repository: on Kibana the
same two rows rebuild 111 and 717 of 106,215 records.

**That 105 is one directory's answer, and the distribution is the claim.** The
cost of an appearance is the number of records watching the directory it
appeared in, so the whole shape is reported rather than one row of it. Over the
checkout below, 1,493 directories, 506 of them watched by anything, and a record
watches 1.3 directories on average. Over Kibana, 29,589 directories, 21,968 of
them watched, and a record watches 4.8. The table reads the other direction —
how many records watch one directory, which is what an appearance costs — and
that direction is skewed enough that its mean would tell you nothing:

| Records watching one directory | Material UI | Kibana |
| --- | ---: | ---: |
| the median directory | 7 | 5 |
| the 90th percentile | 36 | 29 |
| the 99th percentile | 242 | 261 |
| the worst directory in that checkout | 21,500 | 37,126 |

The worst directory there is `packages/mui-icons-material/lib/utils`, home to
the one module that 21,506 generated icons import. Every one of them genuinely
depends on what that directory contains, so every one of them is rebuilt when
its membership changes — which is to say a regeneration of the icons costs what
a cold run costs, and nothing else in that checkout does. Expect the same
wherever a barrel sits under a generated directory. Kibana's worst directory is
`src/platform/packages/shared`. Its root `tsconfig.base.json` maps 222 package
names straight onto directories inside it, `@kbn/i18n` onto
`src/platform/packages/shared/kbn-i18n` among them, and a `kbn-i18n.ts` added
beside that directory would be what `@kbn/i18n` resolves to. So every record
that imports one of those packages watches the directory, 35% of the index.

One repository shape removes the per-directory bound: a `tsconfig` the scan
cannot follow, because it is not valid JSON or because its `extends` does not
land on a `tsconfig*.json` or `jsconfig.json` your repository tracks — a base
installed from a registry, say, rather than one of your workspace's own
packages. A bare specifier is bounded by the `paths` a configuration declares, so
a configuration that cannot be read is no bound at all, and there every added
path invalidates every record. The symptom is a warm run that costs what a cold
one does. [A `tsconfig` the scan cannot
follow](source-structures.md#a-tsconfig-the-scan-cannot-follow) lists every such
`extends`.

### Where the third of a second is

Of a warm run's 301 ms, roughly 116 is decoding the index, 185 is the scan, and
nothing at all is publishing — an unchanged tree has no segment to append. The
scan is two things and neither is a parse: git answering what the working tree
looks like, and about 92 ms of the scanner's own — every record in the index
walked and each checked against its digest. Which of the two is
larger is decided by the accelerators below.

On Kibana a warm run's 2,117 ms is 1,275 decoding the index and 841 the scan,
and again nothing publishing. Git answers the scan's `status` there in about
280 ms, which leaves about 560 ms of the scanner's own. The untracked
cache, one of the two accelerators [below](#git-and-the-two-accelerators), is
why: `core.untrackedCache` is not set on the clone, but the clone's index
already has an untracked cache in it and git uses it. Told not to, with
`-c core.untrackedCache=false`, the same `status` costs 923 ms.

The publish is the smallest of the three because of how little it writes. A run
that changed nothing writes nothing — the index is an append-only chain of
immutable segments, and an unchanged run has no segment to append. A run that
edited four files appends about **14,000 bytes** to a 10.5 MB index. The whole
of it is re-encoded only when the chain has grown past eight segments, which is
one publish in eight and costs about 150 ms more than an append. On Kibana four
edited files append 10,576 bytes to an 81.5 MB index. In a chain of twelve
publishes timed there, the one re-encode took 1,662 ms and the appends about
100 ms each, so the re-encode costs about 1,560 ms more than an append.

### git, and the two accelerators

Everything Variance Authority knows about a working tree comes from git.
`ls-tree` reads the commit and does not grow with the checkout. `status` reads
the working tree and does, so it is the row that matters, and git ships two
accelerators for it that are off by default:

| Asking git for `status` | Material UI | Kibana |
| --- | ---: | ---: |
| neither accelerator | 98 ms | 927 ms |
| `core.fsmonitor` | 56 ms | 793 ms |
| both | 17 ms | 103 ms |

The monitor answers for tracked files: it reports what changed, and git stops
stat-ing every path. The untracked cache answers the other half — what is on disk
that the index has never heard of — by skipping every directory whose
modification time has not moved. It answers only one shape of the question, the
top of the checkout with `--untracked-files=normal` and no pathspec, which
reports a new directory as the directory. So that is what Variance Authority
asks there, and it lists the files of any directory git collapses with
`git ls-files --others --exclude-standard`. Asked with a pathspec or with
`--untracked-files=all`, the same status walks every directory again and costs
what the monitor alone costs: on Kibana, 787 ms with both against 785 with the
monitor alone. There the untracked cache is the larger of the two, and with the
cache alone `status` costs 283 ms.

Eighty milliseconds off every warm run is worth having. On Kibana, a clone with
no untracked cache in its index saves 824 ms, 927 ms to 103. The clone measured
above already has one, so there the two settings save about 180 ms, 283 ms to
103. Nothing here takes it for you: starting a file-system daemon on somebody else's repository is not a
scanner's decision to make. The repository's own configuration decides, and this
is how you make it.

```bash
git config core.fsmonitor true
git config core.untrackedCache true
```

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

ripgrep opens, reads and searches; sense opens, reads, parses and extracts.
Milliseconds throughout:

| Repository | Threads | ripgrep wall | ripgrep user | ripgrep system | sense wall | sense user | sense system |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Material UI | 1 | 420.0 | 30 | 380 | 594.1 | 241 | 355 |
| Material UI | 2 | 240.0 | 30 | 440 | 315.8 | 314 | 438 |
| Material UI | 4 | 180.0 | 40 | 640 | 285.5 | 434 | 817 |
| Material UI | 6 | **180.0** | 50 | 1,000 | **218.2** | 447 | 796 |
| Material UI | 8 | 240.0 | 60 | 1,830 | 293.6 | 931 | 1,591 |
| Material UI | 16 | 550.0 | 80 | 7,740 | 430.8 | 980 | 4,307 |
| Kibana | 1 | 2,980.0 | 220 | 2,750 | 5,479.4 | 3,510 | 2,010 |
| Kibana | 2 | 1,610.0 | 200 | 3,010 | 2,360.2 | 4,307 | 2,805 |
| Kibana | 4 | **1,400.0** | 270 | 5,310 | 1,870.6 | 5,721 | 5,451 |
| Kibana | 6 | 1,580.0 | 300 | 9,180 | **1,543.8** | 6,369 | 6,391 |
| Kibana | 8 | 2,310.0 | 330 | 18,110 | 2,148.4 | 11,400 | 12,646 |
| Kibana | 16 | 4,920.0 | 540 | 66,320 | 3,060.7 | 13,427 | 26,087 |

The two wall columns drawn for each repository, sense in orange and ripgrep in
grey, Material UI first:

```mermaid
xychart-beta
  accTitle: Wall milliseconds for sense and ripgrep over Material UI's files, by number of threads
  x-axis "threads" ["1", "2", "4", "6", "8", "16"]
  y-axis "milliseconds" 0 --> 600
  line [594.1, 315.8, 285.5, 218.2, 293.6, 430.8]
  line [420.0, 240.0, 180.0, 180.0, 240.0, 550.0]
```

```mermaid
xychart-beta
  accTitle: Wall milliseconds for sense and ripgrep over Kibana's files, by number of threads
  x-axis "threads" ["1", "2", "4", "6", "8", "16"]
  y-axis "milliseconds" 0 --> 5500
  line [5479.4, 2360.2, 1870.6, 1543.8, 2148.4, 3060.7]
  line [2980.0, 1610.0, 1400.0, 1580.0, 2310.0, 4920.0]
```

Two curves, one shape. On Material UI both bottom out at six, both climb again,
and both spend almost everything they spend in the kernel. On Kibana ripgrep
bottoms out at four and sense at six, and both climb again. That is what the
table is here for:
a program with no parser, no resolver, no tree and no index collapses at width
on the same machine, which is what makes the collapse the machine's rather than
the scanner's.

The two user columns are the control, and this is the one table on the page that
can carry them, because here the thread count is set per process before either
program starts and caps everything both of them do. Read them downward.
ripgrep's user time goes from 30 ms to 80 ms while its system time goes from 380
to 7,740: its searching never changes, and everything that happens to it across
those six rows happens in the kernel. On Kibana it goes from 220 ms to 540 while
its system time goes from 2,750 to 66,320. Sense's user column is larger
throughout, which is what building a syntax tree costs over rejecting a buffer
on a literal prefilter, and on Material UI it is still not what any of these
rows are paying for. On Kibana it is, up to four threads: there sense spends
more time in user code than in the kernel, because Kibana's parse is larger than
its read.

Which of the two is faster is the smaller point, and at the minimum the answer
does not flatter this scanner: 180 ms against 218, so the side that parses
TypeScript and extracts every specifier out of it is 21% behind the side that
does not. At sixteen threads it is 22% ahead, and that is not a win either —
both of them are ruined there, which was the point. On Kibana, whose parse is
the larger half of its floor, sense is 10% behind at the minimum, 1,543.8 ms
against 1,400, and 38% ahead at sixteen.

## What these were measured on

Every millisecond above was taken on an Apple M4 Max (Mac16,9) — 12 performance
cores, 4 efficiency, 64 GB, macOS 27.0 on arm64, Node v26.7.0, Yarn 4.18.0,
ripgrep 15.2.0 — on a local SSD with a warm filesystem cache. Two things above
are not from that machine and say so where they appear: the 306,694-file scan,
stamped with the M4 Pro it was taken on, and the 200,000-blob row, which is a
generated repository rather than a real one. A warm cache makes the rest of it
the fast end of the range and a floor rather than a budget: size a CI container
above these, not against them.

The repositories are two this project did not write: [Material
UI](https://github.com/mui/material-ui) at `8f19b1009b`, 41,171 tracked paths,
and [Kibana](https://github.com/elastic/kibana) at `df0daaddcc`, 125,804 tracked
paths. Both are public and pinned, so you can clone either at the same commit
and measure it again, with the committed scripts named below or with your own.

**Four counts of each repository appear above, and no two of them are the same
count**, because each script that produced them has its own reason to disagree
about what a module is. Kibana has a fifth, the files ripgrep reads.

- **24,519 modules, 24.9 MB** is what `source-index.mjs` scans — `packages` and
  `docs/src`, with declaration files left out — and it is what the floor table
  and the whole incremental table are charged per. On Kibana it scans `src`,
  `x-pack` and `packages`: **105,900 modules, 465.2 MB**.
- **27,748 modules, 30.3 MiB** is every module path in the repository,
  declaration files included, which is what the width sweep, the probes, the
  TypeScript-against-Rust comparison and the ripgrep comparison are all pointed
  at. It is the larger set and the larger number, and the megabytes are binary
  where the line above is decimal. Kibana's is **106,971 modules, 446.0 MiB**,
  and its chunk sweep and its row of the pack table are pointed at it too. It
  is 1,071 more than the scanned set: 204 declaration files, and 867 modules
  outside `src`, `x-pack` and `packages`, most of them under `examples`,
  `.buildkite` and `scripts`. ripgrep reads 106,595 of them: it skips hidden
  paths by default, and the other 376 are all under a directory or file whose
  name starts with a dot.
- **24,908** is the records a cold scan **rebuilt**, which is more than the
  24,519 because the walk also records stylesheets and declaration files that
  the module listing excludes. Kibana's is **106,215**, for the same reason. It
  is not the number of records the index ends up holding, which is counted where
  the index is [sized](source-index.md#how-large-it-gets).
- **78** is not a count of files opened. It is how many of those 24,908
  rebuilds came back through the scanner's own read path, the other 24,830
  having been read and parsed inside the native batch where no counter sees
  them. Kibana's **265** is the same count.

Method, because the tables were not all taken the same way. The floor rows, the
git rows and Material UI's cold scan are each the **median of five** timings,
and every Kibana row of the incremental table is the **median of three**. The
width sweep, the probes, the chunk sweep and
the ripgrep comparison are each the **best of three**, which is the run least
disturbed by the rest of the machine. On Kibana the pack-table row and the
one-stream `cat-file` figures are the best of five, `cat-file` start-up is the
median of 21, and the pack-against-disk cold scans are the median of three.
**Every other row of the incremental table is one timing of one run**: read
Material UI's column for its shape and not for a difference of a few tens of
milliseconds, because a single sample is worth about that much either way. On
Kibana a median of three is worth more than that: the unchanged run's three
timings span 2,103 ms to 2,144, and the four-file run's 2,277 ms to 2,584.

The committed scripts are under `packages/sense/scripts`, and each runs against
a clone of either checkout: `source-index.mjs` for the floor table, the
incremental table and Material UI's git rows, `read-width.mjs` for the width
sweep, `scan-cost.mjs` for ripgrep. The rest come from harnesses that are not
in the repository. On both repositories, that is the probes, the chunk sweep,
the pack table, the `cat-file` start-up and the pack-against-disk scans. On
Kibana it is also the publish figures, the `status` figures and the profiled
cold run. The TypeScript figure is the
module reader Sense replaced with the addon, timed against it on the same files
before it was removed.

Material UI is not a large repository, and Kibana is still short of the several
hundred thousand files a large one has. What these rows come to on a checkout of
that size — and what the index and the [execution record](execution-record.md)
weigh there — is in [addressing scale](scale.md).