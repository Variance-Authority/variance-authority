# ripgrep stops exactly where we do

The native scanner fanned to every core and got **slower**. Sixteen threads read
material-ui's 27,744 modules in 420 ms; six read them in 154. That is the
opposite of the premise the whole port was started on, so it needed a floor to
be measured against — some program doing the same thing, written by people who
care about nothing else.

ripgrep is that program. It walks a repository's source files, opens every one,
reads all of its bytes, and reduces them to something much smaller. The only
difference is what "reduces" means: ripgrep runs a literal search, and this
scanner builds an AST and extracts every specifier. ripgrep is doing far less
work per byte, and has had far more attention paid to doing it.

[`scan-cost.mjs`](../../../packages/sense/scripts/scan-cost.mjs) runs both over
the same files at the same widths. The pattern given to ripgrep never matches,
which is its best case — the literal prefilter rejects each buffer without the
regex engine ever starting — so what is left on its side is acquisition, which
is the thing being compared. Apple M4 Max, 16 cores, macOS 27, node 26.7.0,
ripgrep 15.2.0, 27,744 modules and 30.3 MiB:

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

Two curves, one shape. Both bottom out in the middle, both climb again, and both
spend almost everything they spend in the kernel. **At the shared minimum the two
are the same speed — 196 ms against 190 — while one of them is also parsing
TypeScript.** Parsing is the 154 ms of user time in that row, and it is not what
the row costs.

So the ceiling is not this scanner's to raise. It belongs to `open`.

## What the collapse is, and what it is not

Four probes over the same 27,744 files, at widths 1 through 16, each doing a
little more than the last:

```
                 1        2        4        6        8       16
open+close     354      201      150      170      258      705
open+fstat     307      193      165      201      252      620
open+read      350      211      198      190      237      622
stat+open+read 365      222      179      189      232      599
```

`open` and `close`, touching no file data whatsoever, reproduce the entire
collapse. Reading all 31.6 MiB on top of that costs about 34 ms. Three things
follow, and two of them killed an optimization that looked obvious:

- **Data is free; the descriptor is not.** Thirty megabytes is nothing. Twenty-
  seven thousand `open` calls is everything.
- **A second pathname resolution is free.** `stat` then `open` costs what `open`
  alone costs, because the second lookup finds the vnode the first one just
  cached. The scanner now reads through a single descriptor anyway — the size is
  asked of the open file, so the bytes measured are the bytes read — but that is
  a correctness change and it is recorded here as one.
- **Path depth is free.** `openat` from a directory descriptor opened once per
  directory, resolving one component instead of every component of every path,
  matches plain opens at 303 ms against 308. Sorting reads by parent directory
  to get locality is actively *worse* at the useful widths, because 1,161
  directory groups are too uneven to balance.

What is left is concurrent `open` itself, and no arrangement of the same calls
avoids it.

## What was tried and rejected

- **`mimalloc`.** The profile was 98% system time, so an allocator was never
  going to appear in it, and it did not. Removed rather than kept as insurance.
- **Streaming content from git.** One `git cat-file --batch` hands over all
  31.6 MiB in 204 ms, against 165 ms for six-wide filesystem reads. Same order,
  no prize, and it would have carried a real correctness condition: repository
  filters and working-tree conversion can make clean working-tree bytes differ
  from raw blob bytes, so it could not have been switched on without proving the
  files have no content-changing filter.
- **Per-file `mmap`.** Not attempted. ripgrep's authors found it loses on many
  small files, and the measurements here say why: it adds VM work to a process
  already bounded by kernel-wide coordination.

## What this changed in the scanner

Reads and parses are no longer one width. Reads run bounded in their own pool at
a measured constant; parses run at machine width on the global one; each chunk's
reads overlap the last chunk's parses. Acquisition's floor is 165 ms and the
parse is 47 ms, so a perfect pipeline would be about 170 — the measured 196 is
inside 90% of that, which is why there is no channel-based rewrite here. Chunk
size was swept: 2,048 wins at 201 ms best-of-five and 128 loses at 349, because
a step short enough to pipeline finely is short enough that six readers spend it
starting and stopping.

Two widths, not one, is the whole finding. ripgrep's own default is its core
count, which on this machine is the *worst* setting it has — 530 ms where `-j4`
takes 190. Ours defaults to the measured minimum instead, which is the only
place the two programs differ.

## Where the next win is

Not here. If touching a file costs about 5.7 µs of kernel time that nobody can
widen, and the most optimized scanner available pays exactly the same, then the
only remaining move is **not opening the file** — reusing what was extracted
last time when its content identity has not changed. That is worth more than
every parser optimization left on the table, and this is the measurement that
says so.

One caveat on the generator: ripgrep is timed by `/usr/bin/time`, whose
resolution is 10 ms. A repository small enough to scan in single-digit
milliseconds cannot be compared this way, and the script's output for one should
be read as noise rather than as a result.
