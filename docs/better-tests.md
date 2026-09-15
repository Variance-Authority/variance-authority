# Make a suite faster, stabler, smarter and cheaper

Your suite gets slower, flakier and more expensive every month somebody works on
it. You can shard it and buy the time back in machines, retry it and trade a
false alarm for a missed regression, or rebuild the world between tests and pay
on every test for a leak in a few.

Those are the moves available when a run leaves nothing behind but an exit code.
A run also knows which source it entered, which elements it addressed, and what
had already happened before its first line, and teardown is normally where all
of that ends. Keep it, and each of the four axes below has a measured answer
rather than a policy.

Rendered comparison is the loudest use of that evidence and it is one use. The
Vitest 2 and Jest 30 seams instrument, collect and persist around the
transformer you already use, and Eyes watches React Testing Library's `screen`
from a setup file, so selection, order and distillation reach a suite that never
opens a browser.

## Faster: keep the browser you already opened

A screenshot tool opens a browser, navigates, takes one picture and throws the
whole thing away, because a page that already rendered something might colour
what comes next. Do that a few hundred times and the launching is the run.

One Chromium and one page serve a whole run here instead. Measured over 48
renders, a capture into an already-open page costs about **9 ms** against about
**233 ms** for one that launches a browser first. The Storybook collector holds a
single preview open and switches stories over Storybook's own channel rather than
navigating; the renderer keeps a pool of pages keyed by viewport, so 1x and 2x,
or a phone width and a desktop one, come out of one browser in one run.

Painting is the expensive half, so a run avoids it wherever a cheaper reading can
decide: a document identical to the one a baseline was painted from is compared,
found equal, and never photographed again.
[Evidence instruments](instruments.md) measures reading against painting on a
fixture you can run yourself, and those ratios come from one machine and one
Chromium.

Holding the page open is exactly what lets one test's leftovers reach the next
one. The next axis is how that gets caught.

## Stabler: name what moved instead of rebuilding the world

A changed subject is collected a second time, and there are two second passes,
each varying exactly one thing. `again` holds the world and advances time, and
answers whether the subject drifts on its own — reported as `unstable`. `alone`
rebuilds the world and holds time, and answers whether some other subject changed
this one — reported as `order-dependent`.

`again` runs first, and when it finds drift `alone` is never asked: `alone`'s
whole inference is that a clean reading differs from the shared one, which is
only evidence if two readings of one world would have agreed. Neither is a retry
— neither clears a verdict — and `accept` refuses to promote either outcome
unless a sensitivity rule already covers every band that moved. `alone.limit`
caps how much re-collection a red run pays for, and outside a sweep a green run
pays nothing.

An `order-dependent` reading resolves to a region, a component and a source file,
plus the fact that a clean world does not show it. Narrowing from there to the
code that wrote it is a bisection over run order.

A unit suite has the same leak one level down. A client built at a module's top
level, a registry a decorator fills, a clock read into a constant: the work
happened before the first test of every file that imported the module, and
whether it had happened when a given test looked depends on which file loaded it
first. The Vitest and Jest seams snapshot every counter before each file's first
test, so a region already entered by then is recorded as **loaded** by that file
as well as crossed by it.

[Test order and shared state](flakiness.md#test-order-and-shared-state) is the
whole taxonomy, including what a probe can and cannot attribute.

## Smarter: decide from what the run recorded

Selection here rests on what a run recorded itself doing rather than on what a
graph predicts a change could reach. `withTestSelection` wraps the runner
configuration once — installing the reporter it needs along the way — and every
run from then on records which test file entered which source. The next run reads
that back and asks which test files the diff reaches. This repository does it to
itself: `yarn test:since` runs those files through `tools/test-since.mjs` over
`@variance-authority/sense/test-selection`, the published entry point rather than
a private path.

The record rules paths out as well as in. A selection reports how many files it
left behind because the snapshot saw them whole and they entered none of the
change, which is a different claim from a graph that never looked.

[Run relevant work](run-relevant-work.md) is the decision;
[selection](selecting.md) owns the rules that widen it, including how an `nx` or
`turbo` answer is folded in as more changed input rather than a second opinion,
and [distance](distance.md) puts the nearest selected test first and shows one of
this repository's own selections at the commit it was recorded against.

The same record answers questions nobody wrote an assertion for. The process that
produced a pass or a fail also knew which elements were addressed, which
components rendered, which instance scheduled each render, and which branch a
module took, and your test does not change to keep any of it.
[Ask a question the test did not](observability.md) is the record,
[Eyes](eyes.md) is the addressed surface, and [journeys](journeys.md) follow the
source an execution entered across processes.

## Cheaper: stop paying for imports nothing exercises

A test that never calls into a module still pays for it. The import runs, every
change to that file moves the test, and a spy leaves the same trace as a branch
never taken — a file-level answer cannot tell the two apart.

`variance distill` reads each module the test entered region by region, so a
module whose only crossing is its own load is reported as exactly that, and where
declarations went unreached it names them and the substitution to try.

Writing that substitution pays twice: the run stops evaluating the module, and
the scan — which reads `vi.mock`, `jest.mock` and `sb.mock` off test, story and
setup files — stops drawing the edge, so the next selection is narrower too.

[Make one test cost less](optimize-a-test.md) is that loop.

## What each reading asks for

| Reading | Seam | Also needs |
| --- | --- | --- |
| One page across a run | the harness, or a shipped collector | nothing further |
| Order-dependent subjects | a collector that can rebuild a clean world | nothing further |
| Selection and distance | `withTestSelection` in the Vitest or Jest config | a recorded run to select from |
| Order-dependent module state | the same instrumentation | nothing further |
| Region-level distillation | the same instrumentation | one test's execution index, and `variance distill` |
| Addressed elements | `watch(screen)` from `@variance-authority/eyes/rtl`, in a setup file | any object with `getBy` / `queryBy` / `findBy` queries; React commits additionally need that setup file to run before `react-dom`, and the attention journal records the refusal when it does not |

Selection, order and distillation come from one wrap of the runner
configuration. Nothing here asks the suite to adopt a baseline, a `test`, or an
`expect`.

---

**Further:** [`packages/sense`](../packages/sense) for what the scan reads and
where the seams stop · [`packages/eyes`](../packages/eyes) for the attention
journal · [`packages/distill`](../packages/distill) for the analyzer ·
[`performance.md`](performance.md) for what a source scan costs.
