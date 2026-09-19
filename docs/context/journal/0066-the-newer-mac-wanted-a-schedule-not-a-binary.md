# The newer Mac wanted a schedule, not a second binary

**Date:** 2026-09-19

The ask was to tune for the machine people develop on without leaving an M1
behind, and the first answer was a second binary: ship `scan.node` at the
platform floor and `scan-m4.node` beside it, pick between them from the brand
string. It was built, it worked, and it is gone. This records why it was the
wrong axis, because the reasoning applies to the next generation too.

## The binary was never the variable

`-C target-cpu` was the whole of what a second binary could change, and the
first thing to establish is that the baseline is not an untuned one: rustc's
default for `aarch64-apple-darwin` is already `apple-m1` — identical `--print
cfg`, twenty-eight target features either way — and `apple-m4` adds exactly
three, `bf16`, `bti` and `i8mm`. So the trade was never tuned against untuned.
It was one generation of code generation against another, on a workload whose
hot half is reading files.

[`tuned-cost.mjs`](../../../packages/sense/scripts/tuned-cost.mjs) builds each
variant, interleaves the runs round by round so a warming laptop cannot hand its
slowdown to whichever went last, and reports both clocks. On the largest
checkout available here — Apple M4 Max, 16 cores, node 26.7.0, 27,744 modules,
one reader, nine rounds:

```
target-cpu      wall: best    median  user: best    median
default              681.7     722.7       310.7     317.0
apple-m1             687.0     715.8       313.9     319.4
apple-m4             687.2     703.0       317.3     321.5
```

Read the first two rows before the third: `default` and `apple-m1` compile to
the same feature set, and they disagree by 0.8% on the wall and 1.0% on user
time. That is the noise floor, and `apple-m4` sits inside it. A null result on
this corpus and nothing more — at this size the stage is bound by `open`
([journal 0059](0059-ripgrep-stops-exactly-where-we-do.md)) and a compiler
cannot reach the kernel.

It was shipped anyway, on the expectation that the null was a corpus artefact
and the separation would appear at a size this repository cannot hold. That
expectation was tested on a real one, and the separation is not there either.
What is there is a much larger number on a different axis.

## The topology was the variable

On an M4 Pro — 10 performance cores, 4 efficiency cores — over a 306,694-file
scan, with parser width as the only thing moved:

```
parser threads    wall       user
             4    8.8 s     48.9 s
            14    10.9 s    58.0 s   (the default: every core rayon can see)
```

Four parser threads are 18.9% faster than fourteen and spend a third less CPU,
stable across three full-scale samples. The arithmetic is the explanation:

```
6 APFS reader threads + 4 parser threads = 10 performance cores
```

Rayon sizes its global pool from every core it can see, so during the overlapped
read/parse pipeline the process asks for twenty runnable workers on a machine
with ten fast ones, and the overflow lands on the efficiency cores. That is a
scheduling shape, and no `target-cpu` can repair it. `READERS = 6` was measured
([journal 0065](0065-the-read-width-belongs-to-the-machine.md)) against a global parser
pool it was implicitly sharing cores with; the reader width survives, the
parser width was never chosen at all.

## What that changes about packaging

The second binary is removed — loader, build flag, release matrix entry, the
extra file in the darwin package, and the fifth place the matrix check held. One
binary per platform at the floor of the platform, which is what was published
before this and is what ships.

The reason is not only that the tuned build failed to pay. It is that the
variable is not a property of the bytes. An M4, an M4 Max, an Ultra and an M5
want different widths from each other and a package cannot tell them apart: `os`,
`cpu` and `libc` are the only keys a package manager has, and none of them says
how many performance cores are behind it. A machine can be asked that directly
while it runs. So: bundle by architecture, configure by machine.

`tuned-cost.mjs` stays. It is what re-asks the code-generation question when a
generation lands, and the answer it gave is worth being able to reproduce rather
than remember.

## What is not built yet

The width policy. What exists today is one global rayon pool and a measured
reader constant; what the numbers above argue for is three widths — readers,
parsers, resolvers — in private pools, sized from the performance-core count
`sysctlbyname` reports, each overridable for benchmarks and odd hosts, and the
chosen policy printed in diagnostics so a report says which shape produced it.

The heuristic itself should not be written from one topology. `performance
cores - readers` fits this M4 Pro and is not yet a rule: readers are not
continuously CPU-bound, and a base M-series has fewer performance cores than the
reader width that was measured good. Two Apple Silicon topologies is the
minimum before a default is settled, and a base M1 or M2 is the one missing.
