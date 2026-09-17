# storybook-case

**[Variance Authority](../../README.md)** is a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source — the component that
drew the pixels and the `file:line` it was written at.

This case is the Storybook adapter run against a real Storybook, built by
Storybook, read from the outside. Not a fixture shaped like one: `storybook build`
produces `storybook-static/` and the adapter is pointed at the `index.json` that
Storybook wrote — because an adapter tested against an index *we* wrote is an
adapter tested against our own assumptions about the format.

Run it and you will see a built Storybook collected through its own index, a
ticking story diagnosed through `--flakes`, an unstable story refused by name,
and the `new → accept → unchanged → changed` cycle completed with each changed
region resolved to the component and line that wrote it.

The Storybook and its design system are authored here, so this case says nothing
about a third-party component library, a hosted review service, Storybook's own
chrome, or hydration.

## Two words this file uses

A **subject** is one named UI state you asked for and can ask for again — here,
one Storybook story — captured and compared under an id you choose.

A **cause**, on a report line, is the component a changed region is attributed
to. Two stories in this Storybook are tagged `no-variance` and are never
subjects: they are setup stories, run to create a condition the case then
observes somewhere else.

## Before you run anything

Every command below is run **from the repository root**, not from this
directory. The test files resolve `cases/storybook-case` against the working
directory, so a run started here fails to find its own Storybook.

```bash
yarn install
npx playwright install chromium
yarn build
```

`yarn build` is not optional for the CLI suites. The package's own `variance`
script is `node ../../packages/cli/dist/bin.js` — it executes the compiled CLI
directly, and `cli.chromium.test.js` spawns that same `packages/cli/dist/bin.js`.
Neither exists until the workspace is built.

Every suite here skips loudly, naming the missing precondition, when the
Storybook is not built, the CLI is not compiled, or Chromium is not installed.

The CLI uses three exit codes, and the tables below read them:

| code | meaning |
|---|---|
| `0` | nothing needs review, and every subject is accounted for |
| `1` | the run completed and found something a person must decide about |
| `2` | the run did not happen as configured — bad config, missing browser, unreachable store. Never a statement about the UI |

## Running it

```bash
yarn workspace @variance-authority/case-storybook build-storybook
yarn vitest run cases/storybook-case/src/storybook.chromium.test.js
```

The test serves `storybook-static` over a plain node HTTP server, so nothing
depends on a dev server being up.

To look at the stories by hand, on `http://localhost:6199`:

```bash
yarn workspace @variance-authority/case-storybook storybook
```

### The files

| path | what it holds |
|---|---|
| `src/case.stories.jsx` | the fourteen stories |
| `src/ds.jsx` | the design system they render — `Button`, `Stack`, `Card`, `Spinner`, `Clock`, `AsyncPanel`, `Panel`, `SheetLeak`, and the Suspense trees |
| `collector/index.mjs` | the case's collector: which story defers readiness and by what marker, which story is about its own loading state, and where the components live |
| `variance.config.json` | project, viewport, fonts, baselines, and `excludeTags: ["no-variance"]` |
| `.storybook/` | the build every suite but one reads |
| `.storybook-a11y/` | a second build with `@storybook/addon-a11y` installed |
| `src/storybook.chromium.test.js` | the adapter against the real index and preview |
| `src/cli.chromium.test.js` | the whole CLI over one Storybook, as a process |
| `src/alone.chromium.test.js` | order dependence told apart from a regression |
| `src/suspense.chromium.test.js` | a never-resolving boundary, declared and undeclared |
| `src/finish.chromium.test.js` | a story still busy after `storyRendered` |
| `src/globals.chromium.test.js` | the a11y addon stood down for a visual pass |

## What is in the stories

There are **fourteen** stories in `src/case.stories.jsx`, chosen so that the
adapter meets the cases that actually decide whether it is any good. **Twelve**
are subjects. The other two carry `tags: ['no-variance']`, which
`variance.config.json` honours, so the run excludes them by name and reports
`12 of 14 subject(s) observed`.

Twelve of the fourteen — everything except `AsyncPanel — settles late` and
`Clock — ticking` — are collected through **one page and one navigation**. Those
two are exercised separately.

### The twelve subjects

| story | what it is for |
|---|---|
| `Button — primary`, `Button — secondary` | the ordinary path |
| `Card — with actions`, `Card — rebranded token`, `Stack — composed page` | `Button` again, so no subject covers it alone — these five are what a `Button` edit moves |
| `Spinner — mid animation` | something that will not hold still |
| `Clock — ticking` | content that changes because time passed, not because code did |
| `AsyncPanel — settles late` | settles *after* Storybook says it is done |
| `Panel — revealed by its play function` | a subject that does not exist until an interaction runs |
| `Suspense — arrives late` | a boundary no marker could cover: the component that would carry one has not rendered |
| `Suspense — boundary inside a boundary` | a boundary that only exists once the first one resolves, so one clean reading is not enough |
| `Suspense — never resolves` | a boundary that never resolves, which is a flake source and is refused unless declared in `collector/index.mjs` |

The first five rows are the five a `Button` edit moves. The seven subjects below
them — `Spinner` down to `Suspense — never resolves` — are the seven that hold.

### The two setup stories

| story | what it creates | which suite uses it |
|---|---|---|
| `Sheet — left in the document` | leaves a rule in the document, so the next story read in the same page is a different subject | `src/alone.chromium.test.js` |
| `Button — busy after render` | is still pending in `afterEach` when the driver asks for the next story | `src/finish.chromium.test.js` |

Recording a baseline for either would be recording a baseline for the act of
contaminating a page. They are run, never recorded.

## A flake is diagnosed, not retried away

`Clock — ticking` agrees with its baseline but changes between two readings of
the same built story. A normal run settles at the baseline before it needs a
second read; the diagnostic sweep asks the other question.

From the repository root:

```bash
yarn build
yarn workspace @variance-authority/case-storybook build-storybook
yarn workspace @variance-authority/case-storybook build-storybook:changed
yarn vitest run cases/storybook-case/src/cli.chromium.test.js
```

The case drives `variance run --flakes` for that one story and asserts that an
`unchanged` verdict can still carry an `unstable` diagnosis for the named ticking
story. The run exits **1** — something needs a decision. A following
`variance accept` refuses the candidate, because there are two readings and
neither may become the baseline, and prints:

```
accepted 0 subject(s), refused 1
Accepting it would promote one of two readings
```

It exits **2**: the requested acceptance has no safe action, so this is the
operator's to resolve and not a statement about the UI.

This is one timer, one Chromium environment, and one immediate second read. It
does not measure recurrence, a fleet-wide flake rate, or cross-machine
rasterization.

## Order dependence is separated from a regression

`Sheet — left in the document` renders correctly, settles immediately, and
appends a rule to the document that it never takes back. Every story read after
it *in the same page* is read through that rule, so `Card — with actions` grows —
and the comparison says its pixels moved, which is what an edit to `Button` also
says.

From the repository root:

```bash
yarn workspace @variance-authority/case-storybook build-storybook
yarn vitest run cases/storybook-case/src/alone.chromium.test.js
```

The card is collected five times through the shipped collector: twice in the same
page before the leaking story runs, once out of a browser nothing else has
touched, then again in the page that story went through, then alone once more.
The clean subject reads identically alone and in company — same viewport, same
fonts, same source index, and the same static server, so the same environment key
— and the polluted one does not, until it is read alone. That gap is what
`collectAlone` exists to find, and it is what a run reports as `order-dependent`
rather than offering the difference to somebody to accept.

## Readiness is a declared contract

`AsyncPanel — settles late` demonstrates the readiness gap reproducibly rather
than flakily:

- with Storybook's own `storyRendered` signal, the capture is of `loading…`
- with the `readySelector` declared for it in `collector/index.mjs`, the capture
  is of the component

Which is the whole argument for a declared marker over a framework signal, made
by a component rather than by an assertion. A story that never attaches its
marker times out and says which selector it waited for. There is no fallback,
because falling back is how you photograph a spinner and call it a component.

`src/suspense.chromium.test.js` runs the harder half: a boundary that never
resolves, once declared a loading capture and once not. Undeclared, the run names
the boundary, says which component wrote it, calls it a flake source, and exits
without a baseline.

## An addon stood down for the pass

`@storybook/addon-a11y` with `test` set runs axe in `afterEach`, on every story.
A visual pass pays for that twice — once for the scan, once for the phase it has
to wait out before it can switch stories — and reads the answer never, so the
adapter says `a11y.manual` on the preview's channel before it asks for anything.

Whether *the addon* stops scanning when it hears that is a claim about somebody
else's package, so it is checked against the package. From the repository root:

```bash
yarn workspace @variance-authority/case-storybook build-storybook:a11y
yarn vitest run cases/storybook-case/src/globals.chromium.test.js
```

A story that scanned files an `a11y` report, and those reports ride out on
`storyFinished`, so counting them counts scans. The suite collects three stories
— `Button — primary`, `Button — secondary`, `Panel — revealed by its play
function`. Unsuppressed: three scans. The same three with the default globals: at
most the one the URL had already started before anything could speak to the
preview.

It is a separate build, into `storybook-a11y/`, because the addon changes the
subject. Installed in `storybook-static`, it moves the props digest the collector
reads off a card — and not consistently between two renders, which fails
`alone.chromium.test.js`. The Storybook every other suite here reads stays the
one with no addons and no global decorators.

## Driving the CLI end to end

The adapter reads a Storybook. This runs the whole tool over one. From the
repository root:

```bash
yarn build
yarn workspace @variance-authority/case-storybook build-storybook
yarn workspace @variance-authority/case-storybook build-storybook:changed
yarn vitest run cases/storybook-case/src/cli.chromium.test.js
```

`build-storybook:changed` is the same project built with
`VITE_CASE_MUTATION=wide-button`, into `storybook-changed/`. Both builds share
one baseline directory, so the second is a branch judged against its trunk rather
than two independent runs compared afterwards.

Four steps, which is the workflow a team actually runs:

| step | verdicts | exit |
|---|---|---|
| `variance run` on a fresh checkout | 12 new | **1** |
| `variance accept --all` | 12 accepted | 0 |
| `variance run` again | 12 unchanged, *nothing to review* | 0 |
| `variance run` on the changed build | 7 unchanged, **5 changed** | **1** |

The last row is the one worth reading. `Button` appears in five of the twelve
subjects, and the run finds exactly those five. The report resolves to source:

```
[changed] story:case-surface--button-primary
1320 pixel(s) differ across 2 region(s) in Button, and the subject resized from
136×76 to 148×82

  cause      1025px at 17,17 114×48 — Button
      in button "Continue"
      cases/storybook-case/src/ds.jsx:53
      shape v1:91eb0e5b6b0e067766e31876a572b70b
  cause      295px at 37,32 69×15 — Button
      in button "Continue"
      cases/storybook-case/src/ds.jsx:53
      shape v1:b4e5b4bc82d098302edb209a111cf07e
```

The edit is to `Button`. The report says `Button`, at the line that wrote the
element — `ds.jsx:53`, not `ds.jsx:51` where the component is declared, and not
`ds.jsx:26`, which is the `Tokens` wrapper it is rendered inside. Both halves of
that sentence are the claim, and `cli.chromium.test.js` derives the two line
numbers from the file rather than quoting them, so this stays true when somebody
adds an import.
