# Running less of the suite

A change to a few lines should not run every test that imports the file. With
[**execution recording**](execution-record.md), [Variance Authority](README.md)
knows **which parts each test actually covered**. It selects the tests that
reached those lines and shows when no test did —
[what a record knows that no graph can](#what-a-record-knows-that-no-graph-can).

Suppose one changed component reaches **two subjects in a 300-subject suite**.
Selection observes those two when the evidence supports that decision. Any
uncertainty widens the run, and the report explains why.

Selection reads the record across tests. [Distill](distill.md) reads the same
evidence inside one test, looking for work its promise does not need.

[How the test-to-code map stays small](how-selection-scales.md) explains why
that relation can remain practical at monorepo scale without being materialised
as one stored pair per test and region.

For rendered subjects, selection joins possibility to observation. A
[source graph](#the-expensive-row-and-what-retires-it) shows which components
the changed files can reach. A stored baseline records what the subject
**actually rendered**. A subject can be skipped only when both agree that the
change did not reach it.

Other products make different, useful choices. Chromatic's TurboSnap traces a
change through the bundler's dependency graph and tests the stories it reaches.
Percy and Argos leave selection and sharding with the team. The
[product comparison](comparison.md) explains those operating models in context.

A change still has to travel from a file to a component, and for that there is
[an optional file graph](#the-expensive-row-and-what-retires-it) read from the
source itself — a scan, not a build. It answers only that half: a subject is
skipped when its own baseline records none of the components the change reached,
and never because the graph said so.

The graph is a parse of the repository. The component list is written beside the
approved image by the capture that was already reading it, and what that capture
needs is a name on each element: React puts it on the fiber and costs you
nothing, and every other framework needs a build step that stamps it, which is
the same step [attribution](composition.md) needs anyway.

For a route that list is the only link there is. A URL says nothing about what
renders at it, so a change travels from a file to a page by way of the page
having been seen rendering that component — and the answer is exactly as current
as the last render you approved.

```bash
variance run --since origin/main
```

```json
{ "source": { "dirs": ["src"] } }
```

The file list is taken from the **merge base** of `origin/main` and `HEAD` to
the working tree, uncommitted edits included. Against the tip of `origin/main`,
a branch that is behind it would report every file anybody else merged as
changed here, and the selection would widen to the whole suite without a useful
explanation. The hunks the [execution index](execution-record.md) reads are taken from the commit
the index was recorded at, when it names one: its line ranges are in that
commit's coordinates, and a diff from anywhere else lands on lines it never
numbered.

A recording is made by *running* the suite, so the text its line numbers were
cut from is whatever was on disk at that moment, while the position written on
it is `git rev-parse HEAD`. Those agree on a clean tree and nowhere else. Each
changed module is hashed against the text it stands at in the commit the index
names, and one whose two do not agree is charged **whole** — every subject that
ever covered it — and named in the run's notes. Recording once over a clean tree
is what narrows by region again.

```mermaid
sequenceDiagram
  accTitle: Who answers each step of variance run --since
  participant R as variance run --since
  participant G as git
  participant P as parser
  participant F as file graph
  participant X as execution record
  R->>G: diff from the merge base
  G-->>R: changed hunks, and each file's text at the recorded commit
  R->>P: both texts of each changed file
  P-->>R: none, bodies, values or load
  R->>F: who reads a changed value, and who imports a file with no row
  F-->>R: the nearest measured files
  R->>X: the regions and files those answers charge
  X-->>R: the tests that entered them
  Note over R,X: every other test the record observed whole is skipped
```

Each party answers the question it owns. Git says what changed, the parser says
what the change does, the graph says who uses it, and the record says which tests
ran there. When one of them cannot answer, the run falls back to a coarser
answer, such as the changed lines instead of the edit, and names the file.

## What a change to a module's top level runs

A line at a module's top level sits in no function, so by its lines alone it is
charged to the module: every subject that loaded the file. Most edits up there
run nothing new. A comment, a type or a new function does not change what the
module does as it loads, and a changed constant changes only the code that
reads it.

So each changed file is read from both of its texts, the recorded one and the
one your diff makes of it, and charged by what the edit does. A changed value is
charged where it is read, not where it is loaded:

```mermaid
flowchart LR
  accTitle: A changed value selects the tests that entered a function reading it
  change["limits.ts<br/>LIMIT = 10 → 20"]
  clamp["clamp() in limits.ts<br/>reads LIMIT"]
  onChange["onChange() in slider.ts<br/>reads LIMIT"]
  render["render() in slider.ts<br/>reads no LIMIT"]
  drag["slider.test.ts<br/>selected"]
  snap["snapshot.test.ts<br/>skipped"]

  change --> clamp
  change -->|"one import away"| onChange
  clamp -->|"entered by"| drag
  onChange -->|"entered by"| drag
  render -->|"entered by"| snap

  classDef quiet fill:none,stroke-dasharray:4 3;
  class render,snap quiet;
```

`snapshot.test.ts` loaded `slider.ts` and rendered it, and it still is not
selected: nothing it ran reads `LIMIT`.

| The edit | What it selects |
|---|---|
| A comment that sets no JSX pragma, a type outside a decorated class, formatting | Nothing |
| A new function | Nothing, until a change calls it |
| A function body | The subjects that entered the changed regions |
| A top-level value, such as `LIMIT = 10` becoming `20` | Those, and every subject that entered a function reading `LIMIT`, in the file or in a file that imports it |
| Anything that runs as the module loads, a JSX pragma such as `@jsxImportSource`, which decides what every element compiles to, and a type in a decorated class, which `emitDecoratorMetadata` writes into the class as it is defined | Every subject that loaded the file |

A read is followed one file deep, through each file that imports the value, and
further only through a re-export. A file that imports the module as a namespace
and hands it on whole is charged whole, because no name follows the value from
there.

A change travels by use. A new module selects nothing until something calls it,
and an import you add to a file charges the functions in that file that use the
imported names, not every subject that loads the file. This assumes that loading
a module only declares what it exports. When loading it does more, say so where
your bundler already looks: the `sideEffects` field of the module's
`package.json`. A file that field declares, by `true` or by a matching pattern,
is charged to every subject that loaded it. An import you add or remove is
charged to every subject that loaded the importer when it starts or stops
loading a declared file, directly or through what that file imports, that the
importer did not already load. A test that loaded a
changed file through no import the file graph holds is named, not selected: the
edge the graph is missing is the thing to fix. The run prints a line per changed file saying how it was read, or why it
could not be — a diff that does not apply to the recorded text, a text that does
not parse — and a file that could not be read is charged by its lines.

## Where selection widens

Selection is deliberately conservative because the two possible mistakes have
very different costs:

- A subject observed when it need not have been costs a collection.
- **A subject *skipped* when it should have been observed produces a green run
  over an unwatched surface.** It does so silently, because that subject is not
  in the report to be missing from.

So every uncertainty resolves toward observing:

| Situation | What happens |
|---|---|
| The subject has no baseline | Observed. It is new; nothing is known about it |
| Its baseline records no component list | Observed. Absent is *unknown*, never *renders nothing* |
| A changed file under `source.dirs` declares no component | **The whole suite runs.** A stylesheet, a token file or a shared helper repaints subjects without naming itself in any of them. This is the row [a file graph retires](#the-expensive-row-and-what-retires-it) |
| The diff reaches components and **no baseline records any of them** | Narrowed, and **named**: the run prints what it reached and could not match. The one row that does not resolve toward observing, and the one [`source.unrendered` controls](#a-change-nothing-has-been-seen-rendering) |
| The diff touched nothing under `source.dirs` | The whole suite runs, and says so |
| The index was recorded over a dirty tree | Each module whose recorded text is not the text at the index's own commit is charged whole, and named. Its line numbers are coordinates in a text that is not this one |
| `git` could not list the diff | The run refuses. An empty diff read as "nothing changed" would narrow to nothing and report success |
| `--since` with no `source.dirs` | The run refuses, for the same reason |

The last three produce an explicit warning or stop. A run that stays whole
without saying so looks exactly like a selector that found nothing affected,
although those facts require different next steps.

These rows read the baselines and the file graph. When the suite also keeps an
[execution record](execution-record.md), the record reads the same diff next
and removes every subject it recorded whole that the diff did not reach, the
subjects the two whole-suite rows kept included. It also keeps every subject it
recorded entering the changed lines, including one whose baseline names none of
the components the change reached, so the run prints the subjects it kept that
way. A changed module it has no row for, such as a new file, is read as a
module with a row is, with every export counted as changed: the subjects that
entered a function reading one of them are selected. A path that reading cannot
answer, such as a stylesheet, a module whose loading does something, or a text
that does not parse, is answered by the measured files that import it, and one
nothing measured imports keeps no subject in the run. Two refusals stand over the record, because it
never saw what they are about — a change to a file named in
[`source.before`](changes-before-and-beyond.md#how-a-change-before-reach-is-declared),
and an install that could not be compared.

## What a skipped subject looks like

It is in the report, with the sentence that skipped it:

```
[not observed] story:checkout--summary
not affected by the diff against origin/main: none of its 4 components touched
```

That is the same `excluded` state a shard filter produces, and it behaves the
same way: it does not gate, and `variance report` over several shards
[promotes a subject every shard excluded to `failed`](../packages/cli#sharding-report-takes-more-than-one-file)
— because the combined report needs to distinguish a deliberately excluded
subject from one no shard observed.

## Where `source.dirs` starts the answer

`source.dirs` names where component discovery and source traversal begin. With
`source.relations: true`, it is a starting point rather than a graph boundary:
an import from `src/` into `design/button.css` brings that stylesheet and the
files it reaches into the graph, so a later diff can be followed through them.

The directories remain a **declaration about scope** where no graph edge brings
a file in. A changed file inside them that the scan did not read is a gap and
forces a whole run. A changed file outside them is ignored when another in-scope
change gives selection an answer; when the whole diff is outside the graph or
the declared directories, the run is whole because the diff says nothing about
which component changed. That is why `README.md` beside a component edit does
not widen the run, while a diff containing only `README.md` does unless an
execution record is kept.

A file your code reads without importing it has no edge: a schema a mock server
loads with `readFileSync`, or a fixture read by path. Name it in the module that
reads it:

```ts
/// <depends path="./schema.graphql" />
```

The line can sit anywhere in the file, and the path is relative to the file.
TypeScript and your runtime read it as a comment. The scan reads it as a
`depends` edge, so a change to `schema.graphql` reaches every test that loads
the module. A directive with no `path` is reported as a gap in that file.

## A change nothing has been seen rendering

`RootLayout` renders every page in the app and appears in no client fiber tree,
because it is a server component. No baseline records it, and a change to the
global stylesheet reaches exactly that one name:

```
globals.css ← layout.tsx ← RootLayout
```

Every subject records none of it, so every subject is ruled out — and that is two
facts wearing one shape:

- **nothing here watches that surface.** A `Button` no story renders is the
  ordinary reason to run nothing, and running nothing is the whole point of
  `--since`.
- **something here paints it without recording it.** A server component. Then the
  skip is a green run over a stylesheet that repainted every page.

Nothing in the selector separates them: both are components declared in files no
subject imports. An observation surface narrower than the source tree is the
ordinary state of a repository, not a defect to infer around — so the run narrows,
and **says which components it could not match**:

```
`--since HEAD~1` ruled out every subject: it reaches 1 component no baseline
records (RootLayout), so either nothing here watches it or something here renders
it without recording it
```

The rule is the intersection and not the difference. One unrendered component
*beside one that is* rendered is what a real scan looks like — `const Comp =
asChild ? Slot : "button"` is a component to an index and to nothing else — and a
sentence on the difference would print under every run touching a file that
imports a component written that way.

```json
{ "source": { "dirs": ["src"], "relations": true, "unrendered": "whole" } }
```

`whole` is your statement that your subjects paint those components without
recording them, and the run observes everything when it reaches only them. A
server tree is always that, and for now so is anything outside the browser.

## The expensive row, and what retires it

`src/tokens.css` is the file every design system is most afraid of, and so is the
shared helper, the theme provider, the icon nobody thinks about. None of them
declares a component, so each one runs three hundred subjects to report the two
that changed.

The answer is two hops away, and the hops are written down in the source:

```
tokens.css ← button.css ← Button.tsx ← Button
```

```json
{ "source": { "dirs": ["src"], "relations": true } }
```

That reads what imports what — `import`, `export … from`, `import()`,
`require`, `@import`, `@use`, `@forward`, `url()`, CSS Modules' `composes … from`
— and changes the question from *what does this file declare* to **what reaches
this file**. It is off by default because it costs a scan of the source tree, and
because a graph is only worth selecting on if it is honest about its own holes.

Type-only requests stay in that graph, so source-oriented tools can follow them.
Runtime selection does not walk them by default: every compiler erases
`import type`, so a change connected only through a type edge reaches no
importer, test or rendered subject unless another runtime edge also connects it.

The same holds for an edit. Each changed JavaScript or TypeScript file is read
from both of its texts before anything is walked, the way the
[execution record reads it](#what-a-change-to-a-modules-top-level-runs), and a file whose edit
was a comment, a type outside a decorated class or formatting seeds nothing. It
reaches no component and does not force the whole suite, with a graph or
without one, and the run names it in the sentence under its answer. A file that
was added, deleted or does not parse is a change whatever the edit was.

The graph trusts the text, and the text is wrong in one known way: a test that
calls `vi.mock('./api')` imports `./api` by the letter and runs none of it. The
scan reads those calls off test, story and setup files as it goes, and the
mocked module is taken out of the graph as seen from that file at every level —
the test is not selected by a change to the module it replaced, nor by one to
anything only that module reaches. A `source.taints` table says the same for
what no reader can see, a framework's own import notation, in the other
direction as well: `+` rows for imports the text does not write.

It is arranged to over-include in exactly the same direction, and has three
refusals of its own:

| Situation | What happens |
|---|---|
| A changed file under `source.dirs` is not in the graph | The whole suite runs. The roots are your statement about where renders come from, so a file inside them the scan never read is a gap in the scan, not a file that affects nothing |
| The diff is entirely outside the graph | The whole suite runs. A CI config, a `tsconfig`, a build config: none of them is a node here, and every one of them can repaint the suite. A lockfile is the exception — it is [read rather than counted](changes-before-and-beyond.md#why-the-lockfile-is-read-and-not-diffed) |
| The files it did reach declare no component | The whole suite runs. That is also exactly what a changed file declaring a component the scan failed to recognise looks like |
| A file's own imports could not all be read — `import('./' + name)`, a `require` this could not read as a literal, a parse that did not finish | The edges it could read are walked. The one it could not is left to the [execution record](execution-record.md), which sees the module load whatever expression named it |
| A relative specifier resolves nowhere | The same: the specifier is recorded with the file's reason, and the edge is the record's to answer |
| A bare specifier resolves nowhere | It becomes an edge to a [package node](changes-before-and-beyond.md#what-a-bumped-package-reaches) under the name it asked for and does not widen the graph. Whether the package is installed here decides nothing about which files import it. If it names repository source through an alias or build plugin, configure that mapping or supply the package boundary through the project graph |

The graph walks what is written. A specifier built at runtime has no written
target, and seeding every such file on every diff would make the run as wide as
the codebase's least legible corner. Recorded coverage has no such blind spot:
a module that loads under a test is in that test's record however it was
named. The file's reason stays on its record, so the scan can say which files
hide an edge.

What the scan reads, and where it stops, is
[`packages/sense`](../packages/sense). The graph itself is data: fold the records
into it, walk it, ask it things. The traversals live in
[`core/relate`](../packages/core/README.md#entrypoints) and open nothing, so a repository
that already computes its own dependency graph can feed this from that instead.

## What `nx` and `turbo` know that a scan cannot

A specifier scan stops at the package boundary. In a workspace,
`@scope/design-system` resolves into that package's **built output**, and built
output is not what anybody edits — so a diff inside one package reaches nothing
in the package that consumes it, and every monorepo has exactly the component
library that boundary hides.

Both tools compute that edge already, from the manifests, and every repository
that has one has already configured it:

```json
{ "source": { "changes": { "tool": "turbo", "task": "build" } } }
```

Their answer is **more changed input, never a second opinion**. Every file under
an affected project is treated as though the diff named it, and selection
proceeds from there as it does from any other change; the two answers union, and
neither overrules the other. Taken as the selection instead, it would give up
most of what selection is for — a project is hundreds of subjects, and
a one-line change to a leaf component marks the whole package affected.

[TanStack Query](selection-tanstack-query.md) shows what that costs. The
repository runs `nx affected` on every pull request, so the graph there is not
hypothetical. A one-line change inside `query-core` marks the 24 packages that
depend on it, which is 168 of the 188 test files. Asked which tests covered
that line, the record answers 10. Across sixty commits, `nx affected` selects
3,464 test file runs and the record selects 775.

Nx is not wrong about any of it: every one of those 168 files sits in a package
that depends on the edited one. Only 149 of them load the edited module at all,
and a manifest cannot say which of those ever ran the line.

`turbo` needs the `task` because its filter answers *what would run*, not
*what changed*; naming it is how you say which pipeline's inputs match what a
render depends on. `nx` answers about projects without being told.

**A tool that fails stops the run.** An empty project list is a legitimate answer
meaning *this diff crosses no package boundary*, so a missing binary and a quiet
diff must not be able to produce the same value — one of them means every
consumer of the changed package is safe to skip, and the other means nothing at
all.

## Changes before and beyond reach

A run reads from left to right: the harness starts it, the tests it started
run your code, and your code goes out into what the install provides. Selection
lives in the middle stretch, where a file has a name the record knows. A
config file nothing imports and a bumped package you never wrote sit outside it,
and they widen a run for opposite reasons —
[changes before and beyond](changes-before-and-beyond.md) is the page about
handling them.

## What selecting costs

A scan runs before every run that selects, so the number that matters is not the
first one — it is the one after a one-line edit. Three things arrive already
known, and each removes a layer:

- **`git` names every file's content without opening one.** A blob's name *is*
  the hash of its bytes, so `git ls-tree` plus `git status` is the entire walk.
- **A digest names the parse.** The parse cache is keyed by content and by what
  the file's name said about reading it, so it can never go stale: two files
  with one key had one content read one way, on any machine, in any branch, in
  any year.
- **A digest plus resolution configuration and witness directories names the
  whole record, edges and all.** Edges are not a function of bytes alone: they
  also depend on resolver settings and on the directories that could have
  answered that file's specifiers. A configuration change rebuilds every record;
  a path appearing, disappearing or moving rebuilds the records watching its
  directory. An unreadable configuration falls back to the whole path set.

30,500 files and 40,479 edges, one Mac:

| | cost |
|---|---|
| Naming every file's content | 95 ms, and nothing opened |
| A cold scan | 3002 ms |
| Parses remembered | 657 ms |
| Records remembered too | 236 ms |
| The run after a one-file edit | 236 ms — the edit is inside the noise |

```mermaid
xychart-beta horizontal
  accTitle: Milliseconds to scan 30,500 files, by what the caches remember
  x-axis ["nothing, a cold scan", "the parses", "the records too", "the records, after a one-file edit"]
  y-axis "ms" 0 --> 3100
  bar [0, 657, 236, 236]
  bar [3002, 0, 0, 0]
  bar [0, 0, 0, 0]
  bar [0, 0, 0, 0]
```

Both caches live in [your cache](cache.md), keyed by repository root, outside
the work tree unless you name a place inside it — so nothing here is committed. Both halves are content-addressed, which is what makes their
location a cost decision, not a correctness one: a stale entry, a cache
from another branch, or no cache at all costs a slower scan and does not produce
a different graph for the tracked tree. Deleting them costs one cold scan and
nothing else.

There is one bounded exception to that invalidation rule. Git-ignored generated
files are not in the digest map, so one can appear or disappear and shadow a
resolution without changing the recorded directory membership. Track the file
when it participates in source resolution, or set `digests: false` to disable
record reuse for a scan that must observe that generated layout directly.

That is the scan, which reasons about the source. What the *record* costs is a
separate arithmetic — how large the snapshot is at two hundred thousand modules,
how much of it one answer opens, and which repositories this stops paying for —
and it is in [addressing scale](scale.md).

## What recording costs while the suite runs

If you have ever turned coverage on in CI you have a number in your head for
what instrumentation costs, and it is a large one. Check it against this before
you carry it over, because the two instruments are not paid for in the same way.

Every suite below is public and unmodified apart from the configuration that
installs the recorder. Every figure is the median of five runs of the whole
suite, the first discarded as warm-up, with the Vite cache and the record cache
cleared between runs so no run is paid for by the one before it. Pass and fail
counts are identical down all three columns. An Apple M4 Max, 64 GB, Node 26.

| | the suite | recording | `--coverage`, V8 |
|---|---|---|---|
| [Zod](selection-zod.md) — 398 runs, 5,656 tests | 8.87 s | 9.05 s — **1.02×** | 11.56 s — **1.30×** |
| [TanStack Query](selection-tanstack-query.md) — 188 files, 4,523 tests | 11.78 s | 12.77 s — **1.08×** | 15.25 s — **1.29×** |
| [Material UI](https://github.com/mui/material-ui), node scope — 452 files, 7,456 tests | 25.88 s | 26.76 s — **1.03×** | 32.49 s — **1.26×** |

A ratio of two timed runs is only worth reading if you know what the machine
does to an untimed one, so the Material UI rounds carry a second unrecorded
arm. Each round runs the suite plain, recorded, and plain again, and the two
plain arms are the band everything else is read against: their medians are
**25.90 s and 25.88 s**, 0.1% apart over five rounds. A 0.9 s recording cost
stands well outside that. On a suite of nine or twelve seconds it would not —
which is the reason the largest row is here at all.

The same suite pinned to two workers, so that it lasts a minute and a half
rather than half a minute, is the check on whether any of this scales with the
clock. Median of three rounds, two baseline arms 0.02% apart: **91.56 s**
plain, **93.69 s** recorded — **1.02×** — and **110.86 s** under `--coverage`
— **1.21×**. Recording does not grow when the same work is spread over fewer
cores, because what it charges for is what the tests ran rather than how long
they took to run. The gap between the two instruments is the figure to carry:
on that run coverage costs 19.3 s and recording costs 2.1 s.

```mermaid
xychart-beta horizontal
  accTitle: Seconds each instrument adds to Material UI's suite on two workers
  x-axis ["recording", "--coverage, V8"]
  y-axis "seconds added to 91.56" 0 --> 20
  bar [2.1, 0]
  bar [0, 19.3]
  bar [0, 0]
  bar [0, 0]
```

That is the setting `--coverage` gives you, not a pessimistic one.
`Profiler.startPreciseCoverage` takes two independent flags — a counter per
region rather than a bit, and block ranges rather than function entries — and
Vitest's provider asks for both. Node's inspector exposes no cheaper mode;
the best-effort one is d8's.

A probe fires only when its code runs, so what you pay tracks what your tests
**ran**. The engine's counters are not fired but read, and
`takePreciseCoverage` answers with every script the isolate has loaded, so what
you pay tracks what the worker **had open**. For one report at the end of a
worker that difference never surfaces, which is why native coverage is the right
tool for the job it was built for.

It surfaces for a selector, because a selector cannot use the read at the end of
the worker. That read is one union per file — every region some test covered,
with no record of which test — and a skip list needs the crossing. So the
counters have to be read after every test, and each of those reads is priced by
the environment rather than by the test. On the TanStack Query suite, where
jsdom puts 193 scripts in a worker, the engine hands 144 of them back to every
one of the 4,494 tests, and the run takes **2.1× to 2.7×** the suite — counters
alone, with the result discarded rather than mapped, attributed and written. The
same reading on Zod, which runs in `node` with 52 scripts in a worker, costs
nothing measurable. One engine, one call, two environments.

You do not have to take either figure. Time your own suite five times with the
plugin installed and five times with that one line taken out, and compare the
medians — one configuration with the plugin behind a flag rather than two
configurations, because two that can drift are one and a coincidence.

Wall clock is not the only cost, and on a large suite it is not the one to
watch. The probes add code to every module your tests load, and each worker
runs and keeps that larger code. So a recorded run can finish in the same time
as a plain one and still need more memory in every worker. On a CI machine whose
workers already use most of its memory, that extra memory is what fails the
run, and it rarely looks like a memory error: the operating system swaps or
kills a worker, and you see tests time out at several times their usual
duration. If a recorded run does that and the plain run does not, lower the
worker count before you look at the tests. Under Jest, `workerIdleMemoryLimit`
restarts a worker once it grows past the limit you set, which caps the growth
without lowering concurrency. Measure memory the same way you measure time:
peak memory summed over every worker, with the recorder and without.

Under Jest 30 on Node 24 or newer, most of that growth does not come from the
probes. Jest 30 calls hooks and event handlers inside an `AsyncLocalStorage`,
and with the implementation Node uses by default, the memory of every test file
that has finished stays in the worker until the heap is close to its limit. Each
worker grows to that limit whether the suite is recorded or not; the probes make
each file larger, so a recorded run gets there sooner. One `beforeAll` per file
is enough to start it. Run the tests with
`NODE_OPTIONS=--no-async-context-frame`, which selects Node's older
implementation, and that memory is released as usual: on a 60-file suite the
heap after the last file drops from 344 MB to 79 MB without the recorder, and
from 422 MB to 95 MB with it. Try the flag before you lower the worker count.

The second worry is size rather than time — one row per test per region sounds
like gigabytes before it is written. What the record does instead, what it
measures at two hundred thousand modules, and how much of it one answer opens
is in [addressing scale](scale.md).

## What a record knows that no graph can

Everything above reasons about **reach**: which components a change touches, and
which subjects have been seen rendering them. Reach is a property of the source,
and a scan is the right instrument for it. Which *lines* a subject went through
while it painted is not a property of the source at all — three stories mounting
one component, with one import graph and one set of files, take three different
paths through it — so nothing above can be asked the question, however good the
graph gets.

A build instrumented with `testSelectionProbes()` from
`@variance-authority/sense/journal` records those paths: for every observed
subject, the regions of each module it crossed while it was painted. That is
what [`packages/playwright-test`](../packages/playwright-test) narrows specs
with, and it answers one question about a suite that a diff never asks:

```bash
variance journeys
```

```
app/src/components/CartCard.tsx  3 observers
  parted     function CartCard/onClick  51-58
    entered  story:cart-card--removing
    missed   story:cart-card--item, story:cart-card--verbose
  unentered  branch CartCard/empty  62-64

pool: 3 observations the journal recorded whole, out of 3 subjects the report names
```

**`parted`** is one module two subjects went through differently — where a flake
that only appears once a handler has run is written, which is why the reading is
[in `flakiness.md`](flakiness.md#which-part-of-the-module-they-took-differently)
as well. **`unentered`** is a region with source of its own that nobody in the
pool covered at all, and that is the row below.

Two things bound it, and both are printed, not assumed. The journal
**accumulates across runs**, so the pool is the subjects this run's report names;
`--all` asks for the record on purpose, and a checkout with no report to read
gets the record *with the sentence saying so*. And an observation the journal
recorded as truncated is **dropped from the pool** rather than counted as having
missed anything — a recording that stopped early proves no absence — with a count
of what was dropped, because a pool of two that should have been three reads as
agreement.

## Where the taints and the record disagree

A taint says what a file's run reaches. The record says what it did. A checkout
that has both — taints from the mock reader or a table, a journal from an
instrumented run — can check one against the other, and every disagreement is a
fact about one of them.

```ts
import { auditTaints } from '@variance-authority/sense/taint';

for (const { test, module, kind, taints } of auditTaints(coverage, relations, tainted)) {
  console.log(kind, test, module, taints?.join(', ') ?? '');
}
```

| kind | what it found |
|---|---|
| `shadowed-but-entered` | a module the test shadows, which the record says the test covered: the mock did not take, or the taint is wrong about it |
| `reachable-but-not-entered` | a module the test reaches on the graph with none of its shadows in the way, which nobody covered for that test: an import the run never loads, or a mock no taint names yet |
| `added-but-not-entered` | a module a `+` row said the test imports beyond its text, which the record never saw the test in: the addition names the wrong file |

None of them is a verdict. Each is the coordinate to look at, and where a taint
said the thing the record disagrees with, the row names **which taints** said
it — a table somebody wrote by hand and a reader over the source are corrected in
different places. The middle row has none: that trail is one the scan drew
and no taint touched.

Two things bound what a row may claim, and both are structural. Only an
**instrumented** module testifies — one with no probes was covered by nobody the
record can see, which is silence rather than absence. And only a **complete**
observation testifies to absence, so the middle question is not asked of a test
whose recording stopped early: a run that ended mid-flight proves nothing about
where it never got to.

It wants both sides to exist, which is what makes it the last thing to set up
rather than the first: a record comes from a [journey](journeys.md), and taints come from a
reader or a table. With one side alone there is nothing to disagree with.

## What the record does not show

Selection skips a test when the record shows that the test did not run the code
you changed. The record lists what ran. It cannot list code that would run now
but did not run when the test was recorded, so a change to that code skips the
test. This happens in two ways:

- [**A branch no run has taken.**](#a-branch-no-run-has-taken) A subject that
  has never rendered `Button` is not selected by a change to `Button`, even when
  it would render `Button` now.
- [**A result a cache returned.**](#a-result-a-cache-returned) Memoization
  changes which code runs, so the record sees nothing in a case the cache
  answered, and a change to the function selects only the case that ran it.

[The first run](#the-first-run) is the opposite case. Nothing is recorded, so
nothing is skipped.

### A branch no run has taken

A subject's baseline lists the components it rendered in the last approved run,
so it has only the branches that run took. Suppose that after your change a
subject would render `Button` through a branch no run has taken. `Button` is not
in that subject's baseline, so a change to `Button` does not select it.

A closer recording does not fix this: the record shows what ran, and this render
has not run. Turning on `source.relations` does not fix it either, because the
file graph adds files a change reaches, not components a subject rendered. A
selector that reads imports instead of a record, such as a bundler graph over
stories, does select the subject, because the story imports `Button` whether it
renders it or not.

Usually the edit that adds the branch protects you. It changes the component
that decides to render `Button`, that component is in the subject's baseline,
and so that edit selects the subject. What is left is a branch that no run
takes at all.

To find those branches, read [`unentered`](#what-a-record-knows-that-no-graph-can).
It lists the regions, in modules a subject loaded, that no subject in the pool
ran. It selects nothing. It shows you the branches your subjects have never
taken, so you can add a subject that takes one.

### A result a cache returned

Memoization is a side effect. A memoizer such as `memoize-one` or lodash's
`memoize` keeps the result of a call, and the next call with the same argument
gets that result without running the function. So the cache changes which code
runs: what a case runs depends on the cases that ran before it.

Anything that learns what a program does by watching it run sees nothing when
the cache answers, and the record is one of those. In a case that got a cached
result, the function and everything it calls did not run, so the record shows
none of it. A change to the function selects the case that filled the cache and
skips every case that got the cached result.

```ts
// src/price.ts
export const formatPrice = memoizeOne((cents) => `${locale.symbol()}${(cents / 100).toFixed(2)}`);

// test/cart.test.ts
it('computes the price', () => expect(formatPrice(1234)).toBe('$12.34'));
it('reads the price again', () => expect(formatPrice(1234)).toBe('$12.34'));
```

Only `computes the price` is recorded as running `formatPrice` and
`locale.symbol`. A change to either one skips `reads the price again`.

Which cases share a cache depends on how long the cache lives:

- **Cases in one file share it.** Only the first case that calls with a given
  argument runs the function.
- **Files in one module graph share it.** This is Vitest with `--no-isolate`,
  or any runner that evaluates a module once per process. A later file calls
  only the memoizer, which the record does not instrument, so nothing in the
  module is recorded for its cases.
- **A file with its own module graph starts empty.** This is the default in
  Vitest and Jest. The first case in each file runs the function.
- **A cache per render or per request starts empty for each case.** React's
  `useMemo`, `memo` and `cache` are empty when a case renders, so the function
  runs and the record shows it.

**A mocked result stays in the cache.** If the case that filled the cache
mocked something the function calls, the cache keeps the mocked result. A later
case with the same argument gets that result without mocking anything. It is
not recorded as running the function, so a change to the real function does not
select it. It can also fail, because it expects the real value and gets the
mocked one. The record shows neither case running the mocked function: one
case mocked it, and the other got a cached result.

**The record does not look inside the cache, and does not clear it.** Either
would change the code you are testing. A case that got a cached result depends
on the case that ran before it: run it alone and it runs the function. That is
order dependence, and [test order and shared state](flakiness.md#test-order-and-shared-state)
is where you find and fix it.

### The first run

No test has a record and no subject has a baseline yet, so nothing can be ruled
out and the whole suite runs. Selection starts to skip tests from the second
run.

---

**Further:** [`distance.md`](distance.md) for the API that measures how far the
change travelled to selected test files, and the inventory and runner work an
integration still owns ·
[`flows.md`](flows.md) for where baselines live ·
[`source.md`](source.md) for how the scan reads a file, resolves a specifier and
remembers both ·
[`execution-record.md`](execution-record.md) for the keys, lookups, traces
and costs of the coverage file ·
[`distill.md`](distill.md) for using that record to make one test smaller ·
[`packages/sense`](../packages/sense/README.md#correct-what-a-files-text-claims-to-import) for the taint
tables themselves ·
[`packages/sense`](../packages/sense) for what the scan reads and where it stops ·
[`packages/cli`](../packages/cli) for the rest of the command line ·
[`comparison.md §2`](comparison.md#chromatic) for what TurboSnap does that this
does not.
