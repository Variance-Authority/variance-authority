# The read width belongs to the machine, not the job

**Date:** 2026-09-19

The scanner reads at a fixed width and parses at the machine's. `READERS = 6` in
[`batch.rs`](../../../packages/sense/native/src/batch.rs) is the read half, and a
constant standing where a workload-dependent number could stand invites one
question: whether a bigger repository earns more reader threads, the way more
work usually earns more hands.

It does not. The relationship runs the other way, and at repository scale
sixteen reader threads finish later than one.

The reproduction takes prefixes of one repository's file list, which holds the
filesystem, the directory shape and the file-size distribution still so that the
only thing moving between rows is how many files are opened:

```bash
yarn build
node packages/sense/scripts/read-width.mjs --root ~/dev/material-ui
```

## The best width does not move with the count

```text
  files      1      2      3      4      6      8     12     16   best
    125    4.7    4.3    4.5    3.8    4.5    4.6    5.3    5.3    4
    250   11.3   11.0   11.1   11.1    9.7   10.9   12.5   12.3    6
    500   18.0   15.6   19.1   19.3   22.9   18.2   26.4   23.0    2
   1000   49.2   37.5   38.0   32.9   33.2   29.8   33.1   33.9    8
   2000   62.4   49.4   48.2   40.2   45.3   51.0   59.0   57.1    4
   4000   93.1   65.5   64.8   65.4   66.6   65.2   86.8   84.1    3
   8000  131.3  104.1   97.5   87.3   91.2   95.4  114.2  114.3    4
  16000  273.8  194.9  179.6  163.9  159.2  171.9  220.5  222.5    6
  27744  511.3  357.7  331.9  310.2  326.4  338.1  445.8  487.0    4
```

Over a two-hundred-fold range in file count the winner stays between three and
six. The `best` column wanders inside that band rather than climbing: the rows
below about two thousand files are short enough that a loaded machine moves them
by more than the widths differ, which is why the band and not the column is the
result. What does not wander is the right-hand side. Twelve and sixteen lose at
every size, and lose by more as the size grows.

## The mechanism is contention, not saturation

Same files, same work, only the width changing:

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

Read the first column against the last. User time does not rise — the parsing,
extraction and harvesting are the same work however many threads open files, and
if anything they finish slightly cheaper. System time rises nine-fold across the
same 27,744 `open` calls, and the per-file kernel cost rises with it, from 18.2
µs to 166.5 µs.

That distinction is the whole finding. Saturation — a device serving as fast as
it can while callers queue — holds the per-call cost flat and flattens the wall
clock. This rises, which means the threads are not waiting behind the work, they
are making each other's work more expensive: on APFS an `open` walks the path
under locks on directory vnodes and the name cache, and those locks are shared.

Two readings are available and both are wrong. It is not the efficiency cores:
this machine is twelve performance and four efficiency, so an E-core explanation
puts the cliff at twelve, and the degradation starts before it while user time
stays flat. It is not this scanner either — ripgrep collapses on the same curve
on the same machine, 190 ms at six threads against 530 at sixteen
([journal 0059](0059-ripgrep-stops-exactly-where-we-do.md)), and ripgrep's own
default is its core count, which is the worst setting it has here.

## What this means for a machine nobody has measured

The ceiling is the filesystem's, so the constant is calibrated, not derived. Six
is what APFS on this machine allows. Linux on ext4 or XFS admits more; an
overlay filesystem in a container, or anything over a network, usually admits
fewer. A constant tuned here is a guess anywhere else, and the generator above is
committed so that the guess can be replaced with a measurement in one command.

The `readers` argument on `readBatch` exists for exactly that and takes any
width. The one axis that would genuinely move the number is bytes per `open`,
because the contention is per-call and not per-byte: a tree of few large files
tolerates more threads than a tree of many small ones. Source trees are the
second kind.

The page cache is warm throughout, deliberately. It separates the cost of the
syscall from the cost of the disk, and it is the pessimistic case for threading,
since extra threads have no I/O latency left to hide behind.
