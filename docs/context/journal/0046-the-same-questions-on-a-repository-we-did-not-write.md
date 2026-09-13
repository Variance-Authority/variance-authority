# The same questions, on a repository we did not write

[Journal 0045](./0045-we-are-a-second-parse-in-a-pipeline-going-native.md) asked
whether the scan wants threads and what the instrument transform costs, and
answered both over this repository: 1008 records, 1177 modules, 8.2 MB. That is
not a large repository, and two of its answers were extrapolations from it.

`mui/material-ui` is on this machine: **16,903 tracked modules, 27,089 records
once the scan follows what they import.** Thirteen times this one, and written by
people who have never heard of this project. Both questions were asked again
there.

## The transform holds, and gets worse

| corpus | modules | esbuild | swc | `instrument()` | of swc |
|---|---|---|---|---|---|
| variance-authority | 1,177 | 571 ms | 176 ms | 184 ms | **1.04x** |
| briefcase | 640 | 353 ms | 121 ms | 133 ms | **1.11x** |
| react-grab-bench | 1,172 | 352 ms | 48 ms | 45 ms | **0.94x** |
| material-ui | 16,903 | 6540 ms | 594 ms | 742 ms | **1.25x** |

```
node .corpus-bench.mjs ~/dev/material-ui       # LIMIT=20000 for the whole tree
```

The ratio that matters is the last column, and it does not move much: our second
pass over a module costs about what a native transpiler's entire first pass
costs, on four corpora none of which were chosen to make it true. On the largest
it costs a quarter more, because material-ui's modules are small — 1.5 KB on
average against this repository's 7 KB — and per-file overhead is a larger share
of a small file.

The split holds too. The parse is 31% of what `instrument()` spends and the walk
and splice are the other 69%, within a percentage point on every corpus. Fusing
the parse into a transpiler that already parsed removes the 31%.

## The scan does not want threads. It wants the disk asked earlier

Journal 0045 measured the parse at 106 ms of a 264 ms cold scan and concluded the
parallelism was real but not worth taking yet, with the trigger set at a
repository size. The repository arrived, and the conclusion was wrong in a way
the small corpus could not show.

A cold scan of material-ui's `packages` and `docs`, profiled by ancestry:

```
27,089 records, 3240 ms cold

  1216 ms   37.5%  idle (waiting on the disk)
   745 ms   23.0%  V8 itself
   487 ms   15.0%  the parser
   289 ms    8.9%  ours
   241 ms    7.4%  the disk
   165 ms    5.1%  the Node runtime
    97 ms    3.0%  the collector
```

The parser's share **fell** from 28% to 15% as the repository grew, and the
largest single bucket is the process being idle. `scanRelations` walks its queue
with one `await` per file, so between one record and the next it waits out a
round trip to the filesystem with nothing else in flight. Reading the same
16,903 files says what that costs:

```
    808 ms  serial, one await per file (what the walk does)
    230 ms  8 reads in flight
    229 ms  32 reads in flight
    210 ms  128 reads in flight
```

Three and a half times, all of it from the first eight, and none of it from a
second core. Threads were the wrong question: a pool of eight would have bought
a share of the 15%, and covering the latency buys a share of the 37%.

## Taking it uncovered a cache that is not keyed by what it is

Processing the queue in waves of eight took the cold scan from 3240 ms to 2075,
and made it non-deterministic: two runs at the same width produced different
record sets, differing in 710 of 27,089 records.

The cause is older than the change. [The parse cache](../../../packages/sense/src/cache.ts)
is keyed by content digest, on the stated grounds that reading a file is "a pure
function of the bytes". It is not. `parsedFrom` passes the *filename* to the
parser, and oxc picks its language from the extension; material-ui holds files
whose bytes are identical and whose names are not — JSX in a `.js` beside the
same JSX in a `.tsx`. Parsed as the first it fails, as the second it succeeds,
and the cache serves whichever arrived first to both. Serially that is arbitrary
but repeatable. Concurrently it is a race.

So it is already possible for a CI cache to answer a `.js` file with the parse of
a `.tsx` one. The waves did not introduce that; they made it visible in a single
run on one machine, which is the only reason it is written down here.

The fix is to key the cache by what was actually read rather than by the bytes
alone — the digest and the extension, and the path test that decides whether
declarations are indexed at all. The keys are opaque strings to the stored
format, so the change is a key and a name, and the cost is that every existing
cache misses once. The waves are worth having only after it.

The measurement scripts are in the scratchpad, and the wave patch with them.
