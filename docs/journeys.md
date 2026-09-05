# The path an execution took

Three stories mount `CartCard`. One of them clicks Remove. The `onClick` body is
a region the other two have never been inside — same file, same import graph,
same props — and no reading of the file can tell the three apart, because the
difference is not in the file. It is in what each execution did with it.

A build carrying `testSelectionProbes()` from `@variance-authority/sense/journal`
records that. A probe sits at every region of the instrumented source where
control can arrive — a function body, a branch, a `case`, a loop body, a `catch`
or `finally`, the code after a decision, the resumption after an `await` — and
each [subject](README.md#read-a-report-from-subject-to-verdict)'s record is the
set of regions it entered while it was painted. That record is the subject's
**journey**: the path one execution took through the source, in every process
the execution touched.

## A path, not a stack

A journey says which regions an execution entered and nothing else. Not how deep
the call went, not in what order, not how many times, and never a value. Two
subjects with one journey ran the same code; two with different journeys parted
somewhere, and the parting is a place with lines.

A region is named by its kind and by the declaration enclosing it —
`function CartCard/onClick` — rather than by where it sits in the file, so an
edit that moves a line under it moves the diff and not the name. The lines are
reported beside the name because the name is what survives and the lines are
where to open the editor.

The record is bounded by the execution and never by a time window. A counter
drained at request boundaries charges a region to whoever happened to be open at
that moment, which is a different subject under load, silently. So the scope is
logical: on the page it is the subject being painted, and in a service it opens
when a request carrying the execution's id arrives and closes when what the
handler returned *settles*, which is the only arrangement under which the code
after an `await` belongs to anybody.

## One execution, every process it touched

A page under test calls a service, and the service runs product source in a
second process that outlives every subject in the run and answers several of
them at once. Nothing inside the page knows it happened, and a suite that cannot
see it runs every spec for every change to a route handler, forever.

What crosses is one opaque id per execution, minted by the driver — the process
running the test — and set on the browser context before the first navigation. The browser sends it on requests it
was already going to send. A service instrumented by its own build reads the id
off the request and reports what it entered under that id, to an address it also
read off the cookie. The subject's *name* never leaves the driver: it is the only
party holding `journey → subject`, so it is the only party that can join, and a
report cannot claim an execution by writing one down.

```ts
import { collectJourneys } from '@variance-authority/sense/journey';

const journeys = collectJourneys({ head: 'api' });

export function handled<Result>(cookie: string | undefined, run: () => Result): Result {
  return journeys.enter(cookie, run);
}
```

Told neither which build it belongs to nor that anyone is listening,
`collectJourneys` installs nothing and `enter` is the identity function. The
same call ships to production and costs an `if`. Under a run, `head` names the
build that minted the service's probes and `VARIANCE_AUTHORITY_JOURNEYS` turns
the head on; the wiring between the driver and a head is
[`@variance-authority/wire`](../packages/wire/README.md)'s, and the join is set
out in the [sense package](../packages/sense/README.md#follow-one-execution-into-a-service).

Every head a run declares must report at least once. A service that failed to
start, was built without probes, or was never wired contributes nothing, and
silence does not narrow: it marks every observation in the run incomplete,
including the ones the page recorded perfectly, with a sentence saying so. *The
head executed nothing* and *the head was not watched* are two facts, and a run
that narrowed on the first when the second was true would skip the one spec
that mattered.

Most suites need none of this. A Storybook preview and a Vitest file are each
one process, the realm that executes is the realm that is watched, and no head
is declared. Nothing above runs.

## Where two subjects parted

```bash
variance journeys --file CartCard
```

```
app/src/components/CartCard.tsx  3 observers
  parted     function CartCard/onClick  51-58
    entered  story:cart-card--removing
    missed   story:cart-card--item, story:cart-card--verbose
  unentered  branch CartCard/empty  62-64

pool: 3 observations the journal recorded whole, out of 3 subjects the report names

note: recorded at 4f2a1c9d0b73
```

**`parted`** is one module two of its observers — the subjects whose whole record
entered it — went through differently. **`unentered`**
is the weaker sibling: regions with source of their own that no subject in the
pool entered at all — not *these two disagree* but *this run never went here*,
which is the code a visual suite is silent about however many subjects it paints.

**The pool is most of the finding.** It is whoever entered a region with source
of its own, which is not whoever loaded the file: a module root is crossed on
import, so every subject in a bundle crosses every module in it, and counting
those would report one pool of everybody for every module in the app. The
journal accumulates across runs, so the default pool is the subjects the
configured report names — this run's question, about this run's subjects — and
`--all` reads the whole record on purpose. An observation the journal recorded
as cut short is kept, because the regions it crossed are real, and dropped from
the pool, because its absences are not evidence; the count of what was dropped
is printed so that a pool of two that should have been three is visible.

**Nothing here is a verdict.** The command exits `0` whatever it finds, because
every suite with two stories per component has partings. A parting is where to
look once something else has said that something changed.

## What reads it

- The [run report](../packages/report/README.md#the-shape) carries the partings
  among the run's own subjects, answered where the journal is. The readers this
  section is for — the pull-request comment, the MCP tools, the review service —
  are on machines without one, so the run asks once and writes the answer beside
  its verdicts.
- The [review service](../packages/tribunal/README.md#review-surface) draws one
  timeline per component: a line for the story nothing varies from, marked at
  every region where its stories took different paths, in source order, and a
  branch lit for the story that entered the region. `cart-card--removing`
  enters one region `cart-card--item` does not, the click handler, and branches
  there; `product-card--sale` enters exactly what `product-card--control`
  enters, so the [variation](variations.md) executes what it renders. A region
  a component's own stories agree on is no mark, whatever other components did
  there.
- [Selection](selecting.md) narrows a run to the subjects and spec files whose
  journeys crossed the changed code, and where the record cannot say, it selects
  more rather than less.
- [Flakiness](flakiness.md#which-part-of-the-module-they-took-differently) ends
  its ladder here. A second reading narrows a flake to a component and a band,
  [parting](parting.md) narrows it to a boundary, and for the flake that only
  appears once a handler has run, the region is the fix.
- [Divergence](composition.md#one-input-two-renderings) asks the same question of
  the document: one props digest, two renderings. A journey asks it of the
  source: one file, two paths. The two are read together, because a component
  that rendered two ways from one input usually took two paths to do it.

## What it is not

- **Not a scenario.** A [scenario](scenarios.md) names the states a test arranged
  and the Acts between them; a journey names regions of source. Two scenarios
  can part at an Act while their journeys agree, and two journeys can part in a
  handler no Act names.
- **Not a trace.** No timing, no depth, no arguments, no return values. A
  journey is presence at a region, which is what lets it cost one counter per
  region and cross a process on one cookie.
- **Not history.** A journey is one execution. What the same subject did over
  the last forty runs is [history](history.md), and the two answer different
  questions: history says *this keeps moving*, a journey says *here is where it
  went this time*.
- **Not a baseline.** Nothing is approved, nothing is compared against an
  earlier revision, and nothing exits non-zero.
