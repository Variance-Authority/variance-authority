# Spec 0028 — the instrument that records the path, not the percentage

**Missing:** the worker runtime, the runner seams, and every
consumer. `@variance-authority/sense/instrument` emits presence probes, but
nothing runs source and tests to produce coverage data, or joins that data to a
diff to select tests.
**Built on:** [ADR-0038](../context/adr/0038-a-change-reaches-a-component-through-files.md)
and [ADR-0041](../context/adr/0041-a-request-is-the-edge-a-binding-is-the-name.md)
(the `oxc` reader this shares a parse with),
[ADR-0004](../context/adr/0004-defer-native-acceleration.md) (native
acceleration stays behind a measured gate),
[ADR-0013](../context/adr/0013-packages-are-named-for-their-requirements.md)
(the package is named for what it requires — a runner),
[ADR-0093](../context/adr/0093-probes-are-placed-after-the-transforms.md)
(regions cut from the authored text, probes placed after the transforms).

## Purpose

This is the only part of [0027](0027-a-test-is-selected-by-what-it-executed.md)
that *manufactures* an artifact. Everything else consumes what it emits and can
be stubbed against a fixture; nothing can stub this. It is also a pure function
—`instrument(source, id) → { code, map, blocks }` — so it is testable with no
runner, no disk and no index, which makes it both the first thing to build and
the cheapest thing to refute.

## What would discharge it

**1. The probe set.** A probe records entering a module, function, branch
outcome, continuation, loop body, `switch` case, handler, or `await` resumption.
The instrument’s output is an input to coverage collection, not coverage data or
a test-selection result.

**A decision carries no probe of its own.** Its outcomes do. A bare
`if (c) { A }` gets both *entered* and *fell through*, because a change to `c`
must reach every test that ever evaluated it.

**Ternaries, `&& || ??` and `?.` are not decisions in v1**, and this is the
brief's own rule: for `if (order.isPremium && order.total > 100)` the fact worth
recording is which branch ran, not which operand short-circuited. They belong to
their containing region.

**2. Cut on the authored text, placed on the transformed text.** A region is
the file's own: its ordinal, name, digest and lines are cut from the file on
disk, so an edit lands on the region it was made in and nothing a compiler
writes is ever a region. The probes go into the text the project's transforms
wrote, after every one of them, because a compiler that reads the syntax it
compiles reads probes as code: Compiled, the CSS-in-JS extractor, cannot
extract a probed `styled` call that takes a function, and turns a probed
dynamic prop into a runtime CSS variable, so the recorded build is not the one
that ships. React Compiler restructures a probed component the same way.

One native call, `place`, takes the authored text, the transformed text and
the composed source map from the transformed text to its sources. It cuts the
authored text exactly as `instrument` does, parses the transformed text with
`oxc-parser`, walks it into regions of its own, and reads the map in one
direction only: from a generated position to the authored region its origin
sits in. Each transformed region gets the probes of the authored regions it
fires, spliced at UTF-16 offsets; nothing is re-printed. It returns the probed
text and the map from it back to the transformed text. When no transform
changed the text, the call is `instrument`.

A region that ran is never recorded as not running; some regions are
over-charged. Every authored region is fired by something, and where the map
cannot say which code runs it, it is fired by code that runs on every path
that can reach it, up to the module's load.

| Case | Rule | Why |
| --- | --- | --- |
| A mapped position | fires the innermost authored region its origin sits in, through the innermost transformed region holding it that the author wrote: a function, or a branch, loop or case some code directly in which came from one of the same kind that no region around it stands for | the code there came from that region, so it runs when that region does; a branch a compiler wrote, such as a memoising compiler's cache check, is skipped on a cache hit, so code charged there would be recorded as not running on that render |
| A transformed region with no text of its own: the `else` or `default` the walk adds | fires the authored one of the same kind and step whose siblings, the `then` or the other cases, its own siblings fire | an absent outcome has no position for a map to name |
| An authored region no origin falls in, inside a function | fired at the entry of the transformed function holding the nearest origin in front of it in code of a region enclosing it | that code runs on every call that can run the region; Compiled's map names a styled component's whole body by its declarator |
| An authored region with no such origin: a function, or a region with none in front of it in its function | fired when the module loads, and so charged to every test that loaded it | a function can be called before any code in front of it runs: hoisted above it, or handed out while an earlier test ran |
| A mapped position in an import statement whose origin is not module code | fires nothing | an import runs when the module loads; esbuild maps the `react/jsx-runtime` import to the first JSX element, which would fire a component's body on every load |
| A transformed region that fires none | no probe | the project wrote it, so a decorator helper or a generated constructor is never a region |
| esbuild's map at an indented line's column 0 | read at the next non-blank character, the snap | esbuild names the first token's origin there, which fired a function's entry from the indentation |
| A transformed text with no code, or a map with no mapping, such as a types-only module compiled to the CommonJS prologue | every region fires when it loads | the module region is all such a file has |

Whether an import statement fires is decided by the origin of its map point:
module code fires the module region, and any other origin fires nothing. A
CommonJS `require` a compiler writes is a statement, not an import, so its
origin fires as any other: a JSX runtime's `require` mapped to a component
fires that component at load, an extra selection and never a miss.

Rule 1 over-approximates through a compiler's own map, and never
under-approximates. React Compiler's map names a component's closing `}` as
the end of its last statement, so the region after an early `return` fires at
the component's entry, and its cache, `c()`, maps to the import, so the module
region fires on every render: extra selections, never a miss.

Two of the rules read a compiler's output by inference, and a compiler not yet
measured can break selection there, with a miss and no error. Rule 2 matches
an added `else` or `default` to an authored one by the regions its siblings
fire: a compiler that reorders cases, or splits one `if` into two, can hand it
the siblings of another, and the probe for the absent outcome fires the wrong
authored region. Rule 1 tells a function the compiler wrote from one the
author wrote by whether the map leads its start back to an authored function:
a compiler that maps its own closure's `function` keyword to an authored
function's start makes the closure pass for the author's, and code the closure
skips on some calls is charged to it. Each new compiler the project supports
is checked against both before it is named.

Alternatives not taken:

| Alternative | Why not |
| --- | --- |
| Probes first, with a caller-declared list of source consumers whose arguments carry none | per library and per caller; a skipped style callback gets no region, so an edit to it reaches only the module region, and React Compiler and whole-file compilers stay uncovered |
| Probes after the transforms, regions cut from the transformed text | breaks the record's address: regions land on compiled lines, and compiler-written code is recorded |
| A strict refusal of a region with no origin of its own | refuses every Compiled module with a dynamic prop |
| Firing a mapped position through the innermost transformed region holding it, whoever wrote it | React Compiler moves a component's code into `if ($[0] !== props)`; a render that hits the cache skips it, and a test that rendered the component twice would be recorded as not running it on the second render |
| Firing a region with no origin at the entry of the code in front of it, wherever that is | a function hoisted above that code, or handed out by an earlier test, runs without it, and a test that ran it would be recorded as not running it |

**3. The worker runtime, and presence is the whole of it.** A per-worker set
of block ordinals, drained per completed test file. No stack is maintained and
nothing records how a block was reached
([ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md)): an
`async` body is resumed once per `await` between other executions, so there is
no frame to pop, and a `catch` or `finally` is a region with its own probe
rather than an unwinding to track. This stage executes instrumented source and
tests and produces coverage data attributed to test files; it is not complete
until that data feeds the diff-based selection stage in
[0030](0030-a-diff-lands-on-blocks.md).

**4. Four runner seams, by real name.**

| Need | Seam |
|---|---|
| instrument | regions cut from the file on disk, probes placed on what the project's transforms wrote, by seam below |
| configuration | the user adds the integration to the runner configuration or CI job |
| coverage owner | the test file that the runner executes |
| selection output | test-file paths for the runner to execute |

| Seam | Cut | Placement | Map handed on | Refused |
| --- | --- | --- | --- | --- |
| `testSelectionProbes`, a Vite build or dev server | at `enforce: 'post'`, from disk | the same hook | probed text to transformed, composed by Vite | a rewrite whose map names no source that is the file, or carries a text for it that is not the file, or has no mappings; a plugin ahead whose `transform` or `load` rewrote the file and returned no map, by name |
| Vitest | test files at `enforce: 'pre'`; every module from disk | a second plugin at `enforce: 'post'` | composed by Vite | the same as a dev server, and a file changed on its way to the `pre` plugin |
| Jest | test files in the wrapper; every module from disk | after the wrapped transformer, through its map, inline or returned | the transformer's map carried past the probes, the inline one dropped | transformed text the instrumenter cannot parse, from a file it can parse; a transformer whose map does not lead back to the file is not refused but handed the probed text, below |
| Rstest | test files in an `enforce: 'pre'` loader | `rstest-after-loader` at `enforce: 'post'`, after SWC and the project's loaders | the loaders' map carried past the probes | a file that reaches the second loader with no map back to it, naming Rspack's `devtool`; a configuration whose loaders, as Rspack lists them, leave the second out, at the first file; where Rspack lists none, at the run's end, a file that went through the first loader and never reached the second |
| `testSelectionRule`, a build Rspack or webpack bundles, such as a Storybook's preview | from disk | `probes-loader` at `enforce: 'post'`, after SWC, Babel and the project's loaders; an ES module, `.mjs` or `.mts` file imports the page collector at its end, a script `require`s it after its directive prologue, and a marked module takes it on a line between the loaders' text and its mark | the loaders' map carried past the probes, moved where the collector was inserted | a file that reaches the loader with no map back to it, naming `devtool`; an `include` the loader cannot reach, where it runs in a worker |

A seam's own error names the file by its project-relative path. Four cases
are still probed, or marked, before the transforms:

- **A file that names its own source map**, a built package, under a Vite dev
  server, Vitest and Rstest: each starts the composed map from that map, so it
  names the build's sources, not the file, and no placement after could join
  it. A Vite build composes from the file's text and places it after the
  transforms as any other module. Jest places it after where the
  transformer's map leads back to the file, and probes it first, without a
  warning, where the transformer composed the build's map: babel-jest reads an
  inline input map and answers in the build's sources.
- **A Jest transformer that rewrites a module and returns no map**, or a map
  that leads back to no source that is the file, is handed the probed text, as
  before, and transforms each such module twice; the run warns once per
  transformer, naming it, that a syntax-reading compiler then reads the
  probes.
- **Vitest browser mode**: `vi.mock` loads a mock under the file's name from no
  text of the file's a map could carry back, so a page probes first.
- **A test file** is cut for its cases before the transforms, so a compiler that
  reads a test file's syntax reads the case marks. The cut keeps every line, and
  its map moves the columns back.

**A run can choose the earlier placement.** Every seam that places probes
takes `placement`: `'after-transforms'`, the default, places as the table
says; `'before-transforms'` places them in the file as read, ahead of every
transform, through `instrument` alone. `testSelectionProbes` and
`testSelectionRule` then sit at `enforce: 'pre'`, the Vitest and Rstest second
halves pass each file through, and the Jest wrapper probes before the wrapped
transformer. No map is read, so nothing in the Refused column fires. It is for
a run whose transforms only strip types or JSX, such as a unit-test suite.
Nothing detects a syntax-reading compiler under it: React Compiler sits inside
another plugin's Babel options, and each bundler names Compiled's step
differently, so the README says to keep the default with one in the run.

The integration does not replace a runner or select individual test cases. It
uses the runner’s normal configuration surface to instrument modules and records
coverage against each test file. Storybook is different: because the tool owns
that execution surface, it may select an individual story. A Playwright page
crossing uses a transport before its coverage joins its test file.

**5. Five hazards that are silent when wrong.**

- A build-time compiler that reads syntax, such as a CSS-in-JS extractor or
  React Compiler, fails or compiles differently on probed text, so no
  transform of the project's reads a probe outside the four cases above. A map
  that names the wrong code is never used: Vite's dev server composes a plugin
  that rewrote a file and returned no map as identity, and a build composes it
  to a map with no mapping, so each plugin's `transform` and `load` is watched
  and such a plugin is refused by name; `map: null` is the plugin saying
  nothing moved, and is believed where the line count is unchanged or the text
  was only appended to; one that moved lines is refused by name. A composed map
  whose text for the file is not the file on disk is refused, which catches a
  `map: null` that moved columns within a line ahead of a step that wrote a
  map; one with no such step after it is not caught, and is a known way to
  miss a test: its probes are placed at the columns the file had, a region
  whose code moved along its line is charged to the code now there, and a test
  that ran it is left out. "None leaves out a test that ran the region" holds
  under that assumption, that a step returning `map: null` moved nothing.
- vitest hoists `vi.mock` calls in its own transform. The module probe must be
  inserted at the **first executable statement after the hoisted block**, never
  at offset 0 — a probe above a hoisted mock changes evaluation order.
- `Function.prototype.toString` returns instrumented text. Anything comparing
  function source, and any framework reading parameter names from it, sees the
  probe.
- **A function's source can leave the realm its probes live in.**
  `page.evaluate(fn)`, `new Function(fn.toString())` and a worker built from a
  stringified closure all ship text into somewhere the module scope does not
  exist. The generated declarations are required, so the first foreign probe
  throws instead of silently dropping coverage data. A function the module
  itself hands to a serializing call — Playwright's and Puppeteer's `evaluate`
  family, `addInitScript`, `waitForFunction`, `$eval`, `$$eval` — written at
  the call or bound in the module, is found from the call and gets no probe,
  so its text belongs to the enclosing region and carries no probe across. A
  declaration exists from its block's start, so one written after a branch
  that can leave opens a region probed there instead of joining the
  continuation its text sits in, and one under a `case` opens a region probed
  in the `switch`'s discriminant instead of joining its case.
- A bare `if` whose `else` is synthesized must not rebind a dangling `else`
  further out.

**Acceptance is end to end.** One run must execute the instrumented source and
tests and persist coverage data per completed test file. A later source diff
must read that data and select the test files that previously entered the
affected blocks, widening whenever the data is absent, partial, or no longer
current.

## What it forecloses

**Externalized dependencies are never transformed.** Vite does not transform
what it does not inline, so a block inside `node_modules` has no probe unless
`server.deps.inline` names it. That is a hole in the index, it must be reported
as *not instrumented* rather than as *not executed*, and it is the difference
between a limit and a lie.

**A browser needs a different transport, not a different instrument.** The same
probes and the same block ids serve a Storybook story; only the path from the
page back to the index changes. Keeping the emitted runtime free of Node
built-ins is what preserves that, and it is a constraint on this package rather
than a later port.

**No Rust yet, and the gate is a number.**
[ADR-0004](../context/adr/0004-defer-native-acceleration.md) holds: JS first,
and a native collector is justified by a measurement showing the JS one is the
bottleneck — not by the volume of events sounding large.

## The runtime contract

The transformed module carries three hoisted function declarations and one
statement, spliced at the end of the prologue. The prologue is the hashbang,
the directives, the imports, the re-exports, and every `vi.mock`, `vi.hoisted`
or `jest.mock` call, because a runner hoists those above everything and the
header must not land in front of them.

| Declaration | Role |
|---|---|
| `__va(i)` | resolve the counter array on first use or when the factory identity moved, then `c[i] = c[i] + 1 \| (r.e > 0 ? EVALUATING : 0)` |
| `__vaR(v, i)` | `__va(i)` and return `v`: the probe for an expression whose value must survive |
| `__vaE()` | lower the factory's evaluating depth by one, spliced after the last top-level statement |
| `__va(0); __va.r.e += 1; __va.c[0] \|= EVALUATING` | the module's own probe, and the raise that marks everything the top level calls as shared |

The one thing the module asks of its realm is `globalThis.__VA__`, a factory
`(id: ModuleId, count: number) => Uint32Array` with one mutable property `e`,
the evaluating depth. `id` is the repository-relative path the module was
instrumented under, and `count` is the number of blocks, so a factory can refuse or replace
an array whose length no longer matches. A module with no factory throws at its
first probe.
Three factories ship, and each is a different answer to *who was executing*:

| Realm | Factory | Keyed by |
|---|---|---|
| a Vitest or Jest worker | the setup file installed by `withTestSelection` | the module id; the worker's journal is written per test file |
| a page | the collector hoisted by `testSelectionProbes` | the module id; a driver drains between subjects |
| a service | the getter installed by `collectJourneys` | the journey in async context, one factory per journey |

A probe re-resolves its counter array whenever the factory identity changes,
and the emitted code is the same in all three realms. A worker that
shares one module graph across test files installs a factory per file; a
service that hands back a distinct factory per journey makes two interleaved
requests count into two arrays with no change to the probe.

**Probe forms.** Every insertion is text at an offset in the text it is placed
on, the authored one under `instrument` and the transformed one under `place`,
and no inserted text contains a newline but one: a module that is only a
hashbang takes its header on the next line, which the separator opens. A region whose body is a block gets
`__va(n);` after its `{`. A bare statement body is wrapped in `{` and `}`,
which is also what keeps a synthesized `else` from rebinding to an inner `if`.
An expression-bodied arrow becomes `(__va(n), expr)`. A function whose
parameters can throw while they bind carries its probe in the parameter list
instead: from the first parameter that can throw, the parameters move into an
object pattern over a rest parameter, the probe is that pattern's first
computed key, and each parameter in front of the first default leaves a
placeholder at its position, so `length`, `arguments` and binding order are
what they were — `f(a, { b }, c = 1)` becomes
`f(a, __va$1, ...{[(__va(n),"")]: { b } = __va$1, 0: c = 1})`. A list whose
first parameter is an object pattern keeps its text and its probe in the body,
because Vitest, Playwright and Rstest read fixture names out of that text. An
`await` is wrapped as
`__vaR(await x, n)` so the resumed value reaches whoever wanted it. A missing
`else` is appended as ` else{__va(n);}` and a missing `default` as
`default:__va(n);` before the closing brace of the `switch`. The statement
after a decision gets `__va(n);` in front of it: that is the continuation, the
region whose arrival does not follow from the region above because an arm may
have returned.

**Identity.** `INSTRUMENTATION_ID` at `packages/sense/src/instrument/index.ts`
is `sense:instrument/presence-v6`. Every module record, journal, account and
coverage file names it. A run is never laid over a record that names another,
and a reader answers from such a record as it holds it, at its own commit, and
names both identities and the regions the difference leaves unanswered. A
change to how a module is cut into regions or to what a hit means mints a new
id. Where in the output a region's probe sits does not: a record made with the
probes before the transforms names the same regions by the same ordinals, and a
hit in it still means the region ran, so it is merged with one made after. The
`entries` mode — the module and each function, nothing between — is a second
recipe under `sense:instrument/entries-v3`. `loads` cuts nothing: each module
gets one mark after its own text and reports its arrival alone, under
`sense:instrument/loads-v1`, and a run made so records no cases. `instrument()`
takes the two walks alone, by its type: a mark is the seam's, not the walk's.
`instrumentationId(mode)` names the recipe a seam was asked for. Jest's transform cache keys on the recipe,
which also digests the instrumenter's sources, so a module cached by an older
release is transformed again.

**Cost.** Under `instrument`, one parse and one walk, O(module length). Under
`place`, two of each, the authored text and the transformed one, plus one read
of the composed map, O(module length + mappings); a seam also reads the file
from disk and asks the bundler for the composed map. Rounded, on an M4 Max, the
probes' own time over the transforms alone: under Vitest, with each file read
once, about 0.34 ms a module, 0.11 ms of it more than `instrument` placed
before the transforms; under Jest with `@swc/jest`, measured before the file was
read once, about 0.33 ms a module, 0.07 ms of it more than `instrument`, paid
once per content version through Jest's cache.
Under `placement: 'before-transforms'` every seam pays `instrument`'s cost
alone.
Instrumenting is done per module per process that bundles, and the runtime records a hit in O(1): one
array read, one write, no allocation after the first resolution.
