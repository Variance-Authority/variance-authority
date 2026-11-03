# Spec 0108 — file use holds every file a test entered

**Missing:** a check, for every runner, that a test's file use names every file
whose functions or regions the test entered. One runner catches one cause of a
miss: a Jest file fails when its CommonJS registry holds a module whose probes
registered and its journal never entered
([`jest-registry.cts`](../../packages/sense/src/test-selection/jest-registry.cts)).
That compares the runner's registry with the journal, not the record's regions
with its file use, and it does not see a symlinked root or a `dist/` file read
as its source.
Nothing holds an ES module, Vitest's module graph, the module list of the
bundler a Storybook build runs on or a Playwright page to the same rule.
**Built on:** that check and its test
(`jest-registry.integration.test.ts`); the file use a test file records,
[ADR-0095](../context/adr/0095-a-test-file-records-what-it-loaded.md); and the
first half of the funnel,
[spec 0105](0105-a-run-records-where-its-loads-drift-from-the-walk.md).

## Purpose

Selection is a funnel, and this is its second inclusion:

```text
file use  ⊇  files(function ∪ region)  every entered file was recorded as loaded
```

A breach is a gap in the recorder, not in the project: a loader the hook does
not see, a cache hit served before it, a module evaluated in another realm. No
runner configuration explains it and no baseline excuses it, so unlike the
drift of spec 0105 it fails the run that recorded it, naming the file and the
test. The check is the record against itself: every file that holds a
function or region a test entered is in that test's file use. It runs where a
record is written, for every runner, and a runner's own registry check, like
Jest's, stays as the one that names the cause.

## File use is recorded or inferred

Some runtimes give no module hook, and the Workers runtime is one. There file
use is inferred from region coverage: a file is used when the run entered any
region of it. The record marks which it holds. Where file use is inferred, the
inclusion is true by construction, so its check is skipped and named, never
reported green. Inference is exact only when coverage includes each module's
top-level range, which evaluation always enters; from function coverage alone
it is a lower bound.

## Shards

Work done once per shard, module evaluation above all, is a precondition of
every case that shard served. A Cloudflare Workers isolate is a shard: it
evaluates the worker's modules once and serves many requests. Its record is
the isolate's, and its file use is the isolate's evaluation, charged to every
case the isolate served.

## What discharges it

- A record whose regions hold a file its file use lacks fails the run that
  wrote it, naming the file and the test, and fails first.
- A fixture whose journal loses an ES module, under Jest and under Vitest,
  fails that check, as `jest-registry.integration.test.ts` fails a lost
  CommonJS module.
- Rstest, Playwright and the Storybook runner each hold the same check, or the
  record says it was not made for that runner.
- A record carries whether its file use was recorded or inferred, and the
  check reports itself skipped where it was inferred.
- A Workers fixture whose isolate serves two cases charges the isolate's file
  use to both.
