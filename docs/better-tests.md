# Make a suite faster, more stable, smarter and cheaper

A growing test suite should give you more confidence to change the code. Too
often it gives you longer waits, failures nobody trusts, and a larger CI bill.
You add machines, add retries, rebuild the environment between tests, and spend
more to get the same answer.

That does not have to be the cost of growth. Fast feedback and reliable tests
belong together. Flakiness deserves a fix. A run should help you decide what to
do next, and every dependency should earn the work it adds.

A test run already knows much of what you need: which code executed, which
elements the tests queried or clicked, and what setup ran before they began.
Teardown is normally where all of that disappears. [Variance Authority](README.md) keeps it
so the work you have already paid for can make the next run better.

Visual comparison is one use of that evidence. The Vitest 2 and Jest 30
integrations record execution through the transformer you already use. [Eyes](eyes.md)
records React Testing Library's `screen` queries from a setup file. Choosing
tests, investigating shared state and reducing unnecessary imports all work in
a suite that never opens a browser.

## Faster: don't surrender to workarounds

Slow tests interrupt development. Unreliable tests teach people to ignore them.
You need feedback that arrives while the edit is still in your head and that you
can act on when it does. Rebuilding the environment can hide a state leak, but
every test then pays for that workaround. Finding and fixing the leak lets you
keep both speed and trust in the result.

Starting a fresh browser for each capture prevents one page's state from leaking
into the next. It also means launching, navigating and tearing down for every
picture. Do that a few hundred times and setup becomes much of the run.

One Chromium and one page serve a whole run here instead. Measured over multiple
renders, a capture into an already-open page costs about **7.5 ms** against about
**205 ms** for one that launches a browser first. These are steady-state capture
times from one machine and one Chromium, not a prediction for every suite.
The [kitchen-sink example](../examples/kitchen-sink/README.md#running-it) carries
the runnable warm-versus-cold benchmark.
The Storybook collector holds a single preview open and switches stories over
Storybook's own channel rather than navigating. The renderer keeps a pool of
pages keyed by viewport, so 1x and 2x, or a phone width and a desktop one, come
out of one browser in one run.

That saving is available where the page is this side's to open. A shipped
collector and the renderer decide when a browser starts, which page a subject is
read in, and when either closes, so they can spend those decisions on speed. A
host runner that drives its own browser has already made them. In [Vitest
browser mode](start-vitest-browser.md) the tab, the tester iframe and the
isolation between test files are the runner's, configured where the runner
configures them, and observing a component it mounted changes none of it — the
same is true of a page your own Playwright test navigated. What stays this
side's in both is the deferred paint: one browser for the whole run, rendering
every captured document, whatever the suite did to reach the state.

Rendering an image is expensive, so a run avoids it when comparing the captured
document is enough. If that document is identical to the one used for the
baseline image, there is no need to take another screenshot.
[Evidence instruments](instruments.md) measures the cost of collecting a document
against taking a screenshot. The timings come from one machine and one Chromium;
they are not a prediction for every suite.

Keeping the page open saves that work, but it also lets one test's leftovers
reach the next. The saving depends on finding those leaks and helping you fix
them. That is where speed and reliability meet.

## More stable: see the root cause

A test that fails intermittently gives everyone a reason to dismiss its next
failure. Retrying may get the build through; it leaves the reason to distrust
the test in place. To fix it, you need to see what changed, under which
conditions, and where the explanation leads. Each check should narrow the cause
and give you evidence for the next step.

When a story or page region changes, Variance Authority captures it again to
check why. Two checks separate timing problems from shared state. `again`
captures it in the same page: does it change on its own? That is reported as
`unstable`. `alone` captures it in a clean environment under the same time
conditions: does removing the earlier subjects change the result? That is
reported as `order-dependent`.

`again` runs first. If the subject changes between two captures in the same
page, a different result in a clean page would tell you nothing about shared
state: a clock could explain both. So an unstable subject is not checked with
`alone`.

Both checks retain their findings; a second capture does not turn a failure into
a pass. `accept` refuses to save either result as a baseline unless a declared
[sensitivity](sensitivity.md) rule covers every kind of change found. `alone.limit` caps the extra
captures on a failing run. Outside a full flake sweep, a passing run pays nothing
for these checks.

An `order-dependent` finding names the affected region, component and source
file, and establishes that the difference disappears in a clean environment.
To find which earlier subject left the state behind, narrow the preceding run
order by halves and check which half reproduces it.

A unit suite has the same leak one level down. A client built at a module's top
level, a registry a decorator fills, a clock read into a constant: the work
happened before the first test of every file that imported the module, and
whether it had happened when a given test looked depends on which file loaded it
first. The Vitest and Jest integrations record what code has already executed
before each file's first test. That initialization is recorded as **loaded**,
separately from code executed during the tests.

[Test order and shared state](flakiness.md#test-order-and-shared-state) explains
these cases and how far the recorded execution can trace them.

## Smarter: let evidence guide the work

Running everything again is an expensive way to answer a small change. When a
test fails, running it repeatedly without learning anything is expensive too.
The previous run should help with both decisions: what needs to run now, and
where to look when it fails.

An import graph tells you which tests might depend on a changed module. A
recorded run also tells you which tests executed the changed code.
`withTestSelection` wraps the runner configuration once, installing the reporter
it needs along the way. Every run then records which source code each test file
executed. The next run uses that record to choose tests for the source diff.
This repository uses the same published API through `yarn test:since`.

The record also explains exclusions. A selection reports which tests have a
complete recording and executed none of the changed code. Missing or incomplete
evidence widens the run or prevents selection; a skipped test has no new verdict.

[Run relevant work](run-relevant-work.md) explains how to choose a workload.
[Selection](selecting.md) covers the fallback rules and how `nx` or `turbo` adds
to the list of changed inputs. [Distance](distance.md) orders selected tests by
how many imports separate them from the edit, so nearby tests give feedback first.

The same record answers questions nobody wrote an assertion for. The process
that produced a pass or a fail also knew which elements the test queried or
clicked, which components rendered, which component instances initiated updates,
and which branches executed. Your test does not change to keep any of it.
[Ask a question the test did not](observability.md) explains what you can learn
from that record. [Eyes](eyes.md) records interactions and component details;
[journeys](journeys.md) connect executed source across processes.

## Cheaper: make the work leaner

More machines can shorten the queue while every test keeps doing the same
unnecessary work. Before buying capacity, ask what the test needs to load at
all. A smaller dependency setup costs less to run and gives unrelated changes
fewer ways to drag the test back into the suite.

Making each test cheaper is not the same as needing every test. [Own fewer
tests](own-fewer-tests.md) asks which distinct decision each test contributes,
where a large fan-out belongs, and how long temporary protection should remain.
The rest of this section assumes the test has earned its place and reduces the
work inside it.

A test that never calls into a module still pays for it. The import runs its
initialization, and an import graph can select the test whenever that file
changes. A file-level [execution record](execution-record.md) tells you that the module ran, but not
whether the test called its functions. A spy that replaced a function and a
branch that never called it can look the same.

`variance distill` examines execution within each module. It identifies modules
that only ran initialization, names the functions the test never called, and
suggests a substitution to try. The suggestion needs verification: initialization
may register a handler or create a singleton the test relies on.

A verified mock pays twice. The test stops evaluating the replaced module, and
the source scanner recognizes `vi.mock`, `jest.mock` and `sb.mock` in test, story
and setup files. It removes the mocked dependency from the graph, so changes to
that module can stop selecting the test too.

[Make one test cost less](optimize-a-test.md) is that loop: find unnecessary
work, try a smaller setup, and verify that the test still checks what matters.

The gains reinforce each other. Reusing setup makes feedback faster. Diagnosing
shared state makes that reuse trustworthy. Recording execution helps choose the
next tests, and removing unnecessary dependencies leaves less to select. The
suite gets better because you understand and improve the work it does.

## What each capability needs

| Capability | Integration | Also needs |
| --- | --- | --- |
| One page across a run | the harness, or a shipped collector | a page this side opens; a runner that drives its own browser keeps its own lifecycle |
| Test-order checks | a collector that can create a clean environment | the ability to mount the subject again, which a runner-owned mount does not offer |
| Selection and distance | `withTestSelection` in the Vitest or Jest config | a recorded run to select from |
| Order-dependent module state | the same instrumentation | nothing further |
| Finding unused imports and functions | the same instrumentation | one test's recorded execution, and `variance distill` |
| Recording queried elements | `watch(screen)` from `@variance-authority/eyes/rtl`, in a setup file | any object with `getBy` / `queryBy` / `findBy` queries; React updates also need a commit hook installed before `react-dom` loads; `watch` attaches to that hook and reports when it is unavailable |

Test selection, shared-state records and dependency analysis come from one wrap
of the runner configuration. They work with your existing `test` and `expect`,
and do not require visual baselines.

---

**Further:** [`packages/sense`](../packages/sense) for what the scan reads and
the integration limits · [`packages/eyes`](../packages/eyes) for recorded
interactions · [`packages/distill`](../packages/distill) for the analyzer ·
[`performance.md`](performance.md) for what a source scan costs.
