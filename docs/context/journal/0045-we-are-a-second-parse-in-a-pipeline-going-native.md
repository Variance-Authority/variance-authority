# 0045 — we are a second parse in a pipeline that is going native

Three questions about where this project's own JavaScript is exposed, measured
on this repository: whether the scan should use more than one core, what the
instrumentation transform costs the runner it plugs into, and what either of
those says about a native rewrite.

Machine: 16 cores, Node 26, `rawTransfer` supported.

## The scan does not need threads, and would take them

```
node .scan-bench.mjs           # scanRelations over packages/, cold
1008 records in 264 ms
   106 ms   40.2%  V8 and the collector
    94 ms   35.4%  the parser
    30 ms   11.4%  ours
    24 ms    9.1%  the filesystem
    10 ms    3.9%  the Node runtime
```

`scanRelations` is a serial BFS: one `await readFile`, then a blocking
`parseSync`, one file at a time. So the parallelism is genuinely unclaimed, and
it is claimable two ways.

```
1156 files, 8.1 MB
    74 ms  parseSync, serial (what scan.ts does)
    52 ms  parse (async), 4 in flight
    47 ms  parse (async), 8 in flight
    43 ms  parse (async), 32 in flight

   106 ms  serial: read + parse + indexSource, one thread
    46 ms  pool of 4: same work, results posted back
    39 ms  pool of 8: same work, results posted back
    46 ms  pool of 16: same work, results posted back
```

`oxc-parser` exports `parse` beside `parseSync`; the async one runs on the napi
threadpool and reaches 1.7x without a worker in sight. A worker pool reaches
2.7x on the whole per-file stage, crossing included, and stops improving at
eight.

Neither is worth taking now. The stage is 106 ms of a 264 ms cold scan, the cold
scan happens on a cold cache, and an unchanged file already costs two map
lookups on every run after the first — the layering the index does is worth
more than either of these and is already banked. Sixteen workers are slower than
eight, which is the crossing appearing on schedule.

What makes this worth recording is that it is linear. At fifty thousand files a
cold scan is about eleven seconds, and eight workers make it four. The trigger
is a repository size, not a profile, and `parse` is the cheap half of the answer
when it comes.

## The transform is the exposure, and it is not hypothetical

Every seam instruments the *output* of the runner's own transform:
`jest-transform.ts` calls `instrument(transformed.code, …)` and `vitest.ts`
calls `instrument(code, …)` inside a Vite `transform` hook. So the file is
parsed twice — once by them in a compiled language, once by us in JavaScript —
and the second parse is ours.

Over 603 product modules, 4.4 MB:

```
   269 ms   447 us/file  esbuild: TypeScript -> JavaScript
    81 ms   134 us/file  swc: the same
    82 ms   139 us/file  instrument(): parse, walk, splice probes
```

Against esbuild we are 0.31x of the transform we sit behind. Against swc we are
**1.04x** — our second pass costs as much as the entire native first one, and a
runner that switches doubles its transform time by having us in it. Vitest is
moving to rolldown, Jest ships an SWC transformer, Storybook follows Vite. The
number that matters is not the one we have today, it is the one that arrives
when the pipeline underneath us gets three times faster and does not move.

Splitting `instrument()`:

```
    27 ms  parse only
    82 ms  instrument()   (walk + splice = 55 ms)
```

Two thirds of it is ours, in JavaScript, and that is the part a fused transform
does not remove. Instrumenting off the AST the runner already built — or
transforming TypeScript ourselves with `oxc-transform` and walking the tree we
parsed once — saves the 27 ms and leaves 55, which is still 68% of swc's whole
pass. Only the walk becoming native removes the rest.

## What this says about a rewrite

[ADR-0004](../adr/0004-defer-native-acceleration.md) priced the crossing and it
is priced correctly again here: the worker pool stops improving at eight because
results have to come back, and the async parser wins less than its core count
because the JavaScript after it is still on one thread. Every stage this project
has measured ends by handing an object graph to a JavaScript caller.

The transform is the one place that argument does not apply, and it is the one
place the numbers now argue against us. A probe splice does not return an object
graph. It returns a string, to a caller that is already native, which is the
exact shape that crosses cheaply — and the exact shape ADR-0004's candidate list
never contained, because when that list was written the thing underneath was
Babel.

Not a gate firing: G1 and G2 name normalization, diff and rollup, and this is
none of them. It is a fourth question that needs its own threshold, and the
honest form of it is a share rather than a duration — *what fraction of a
runner's transform time is us* — because the denominator is the thing moving.
