# 0068 — v8 reads the isolate, not the test

The received line on native coverage is that it is nearly free: the counters are
in the engine, so turning them on costs a few percent and anything hand-written
must cost more. [Journal 0027](0027-what-instrumentation-costs.md) closed with
that comparison deliberately missing — `Profiler.takePreciseCoverage` was
rejected on structural grounds, and none of the three grounds needed a
benchmark. The comparison is now made anyway, on two external suites, because
the structural rejection and the cost are different arguments and only one of
them was ever in evidence.

Two questions. What does `--coverage` cost against what we cost, on the same
suite, same machine, same run. And what does V8 cost when it is asked the
question a *selector* asks, which is not the question a coverage report asks.

## The reproduction

The suites are the two published example forks, unmodified except for the
instrument:

- `Variance-Authority/zod-example` — 398 files, 5,656 tests, `environment: 'node'`
- `Variance-Authority/tanstack-query-example` — 188 files, 4,523 tests, `environment: 'jsdom'`

Every configuration in both repositories routes through one function, and the
arm is an environment variable rather than a second configuration — two
configurations that can drift are one configuration and a coincidence, which is
the same reason `tools/uninstrumented.config.mts` re-exports `suite` instead of
restating it.

```js
const ARM = process.env['VA_ARM'] ?? 'default';

export function withTestSelection(config, options) {
  if (ARM === 'us') return install(config, options);
  const test = { ...(config.test ?? {}) };
  test.coverage =
    ARM === 'v8'
      ? { enabled: true, provider: 'v8', reporter: ['text-summary'], all: false }
      : { ...(test.coverage ?? {}), enabled: false };
  return { ...config, test };
}
```

Five repetitions per arm, first discarded as warm-up, median reported. Each
repetition clears `node_modules/.vite` and mints a fresh `XDG_CACHE_HOME`, so no
repetition is paid for by the one before it. Pass and fail counts are identical
across all three arms of a suite — 5,643 passed in zod, 4,494 passed and the
same 22 pre-existing failures in TanStack Query — which is the check that the
arms ran the same work. M4 Max, 64 GB, Node 26.

## What `--coverage` costs

| suite | default | us | v8 |
|---|---|---|---|
| zod | 8.87 s | 9.05 s — **1.02×** | 11.56 s — **1.30×** |
| TanStack Query | 11.78 s | 12.77 s — **1.08×** | 15.25 s — **1.29×** |

Native coverage costs **4× to 15× what we cost** on the same suite. That is the
whole of the "almost free" claim, measured: thirty percent is not almost free,
and the instrument it is being compared against is the cheaper one.

Worth separating from the ratio: the thing the thirty percent buys cannot select
tests. It is one union per worker — every region some test in that file entered,
with no record of which test that was. A selector needs the crossing, and a
union has thrown it away before the process exits.

## It is already the expensive setting

The obvious objection is that the v8 arm is running in a precise mode nobody
would choose, and a fast mode is being left on the table. There is no fast mode.
`Profiler.startPreciseCoverage` takes two independent flags — `callCount` keeps
a counter per region instead of a bit, `detailed` keeps block ranges instead of
function entries — and Vitest's provider asks for both:

```js
// @vitest/coverage-v8/dist/index.js
session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true })
```

`dist/browser.js` does the same. The 1.30× above *is* the setting `--coverage`
gives you, and it is the most expensive of the three useful ones. Node's
inspector exposes no best-effort mode at all; `Coverage.startBestEffortCoverage`
is d8's.

## What V8 costs when asked the selector's question

A coverage run reads the counters once, when the worker is finished. A selector
cannot use that read: it has to know which test entered a region, which means
reading at the end of every test rather than at the end of the process.
`takePreciseCoverage` is the only read V8 offers, and restarting the profiler is
how the counters are cleared between reads.

The cross of both moments against all three settings, median of three, against
each suite's default arm:

| | zod / read per file | zod / read per test | tq / read per file | tq / read per test |
|---|---|---|---|---|
| function | 8.05 s — 0.91× | 8.53 s — 0.96× | 12.18 s — 1.03× | 25.02 s — **2.12×** |
| binary | 8.04 s — 0.91× | 8.66 s — 0.98× | 12.60 s — 1.07× | 29.95 s — **2.54×** |
| precise | 8.06 s — 0.91× | 8.72 s — 0.98× | 12.56 s — 1.07× | 31.40 s — **2.67×** |

The sub-1.00 column is not a finding — this arm runs V8's counters raw, with
Vitest's provider off, so it skips the remapping and reporting the 1.30× above
includes. It is the *shape* of the table that matters: reading per file costs
almost nothing at any setting, and reading per test costs nothing on one suite
and 2.1× to 2.7× on the other. Same engine, same read, same flags.

## The mechanism, which is the finding

`takePreciseCoverage` returns coverage for every script the isolate has loaded.
Not the scripts the test touched — the scripts the *worker* has. So the per-test
read costs a function of the whole program, and the per-test shape pays it once
per test.

Counting what comes back per read says it directly:

| scripts per read | zod | tq |
|---|---|---|
| per file | 52.3 | 193.4 |
| per test | 35.5 | 143.6 |

A test in TanStack Query touches a handful of modules and is handed 143 scripts
back, because 193 are loaded and jsdom is most of them. A test in zod is handed
35, because a `node` environment worker has 52 scripts in it and there is
nothing else to pay for. That is the entire difference between the two suites,
and it is why the detail flags matter on one and not the other: `function`
detail prunes the payload to 10.1 scripts per read on tq and buys back most of
the cost, while `precise` returns all 143.6 and costs 2.67×.

**Our probes cost what the test executed. V8's read costs what the isolate
loaded.** A counter increment is paid by the code that runs; a coverage read is
paid by the code that exists. For the job V8's counters were built for — one
union, once, at the end — that distinction never surfaces, and the design is
right. For a selector it is the whole bill, and it grows with the environment
rather than with the work.

The per-test figures are a floor besides. Nothing in that arm keeps the result:
it is counted and dropped. A real collector would still have to merge it, map
byte offsets in transformed text back to somewhere an author edited, attribute
it to a path, and write it.

## What is not measured

**The remap.** The 1.30× is Vitest's provider end to end, and the raw arm is the
counters alone; the difference between them is remapping and reporting, which is
not separated here. It only widens the gap, so the reported ratio is the
conservative one.

**A jsdom suite under our instrument.** The 1.08× on TanStack Query is our cost
on a jsdom suite, but the comparison that would close the loop — our per-test
cost as the environment grows — is the same measurement with the environment as
the variable, and it has not been run. The prediction is that it is flat, since
a probe in a module jsdom loaded and the test never entered never fires. It is a
prediction.

**Anything but Node.** V8's counters are the reason the structural rejection in
spec 0027 stands regardless of any of this: Node-only, byte offsets over
transformed text, and path-free. A browser suite has no `takePreciseCoverage` to
be expensive.
