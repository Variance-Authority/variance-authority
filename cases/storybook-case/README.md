# storybook-case

**Showcase:** advanced Storybook integration, readiness, flake diagnosis, and
durable CLI workflow; not ordinary visual regression.

**A real Storybook, built by Storybook, read from the outside.**

Not a fixture shaped like one. `storybook build` produces `storybook-static/` and
the adapter is pointed at the `index.json` that Storybook wrote — because an
adapter tested against an index *we* wrote is an adapter tested against our own
assumptions about the format.

**What it proves:** a built Storybook can be collected through its own index,
diagnose a ticking subject through `--flakes`, refuse an unstable subject by
name, and complete the `new → accept → unchanged → changed` workflow with
source attribution. The separate Storybook capture suite measures the readiness
stories below.

**Boundary:** the Storybook and design system are authored in this repository.
The case does not prove a third-party component library, hosted review service,
Storybook chrome, or hydration behavior.

## Running it

```bash
yarn workspace @variance-authority/case-storybook build-storybook
```

```bash
yarn vitest run cases/storybook-case/src/storybook.chromium.test.js
```

The test serves `storybook-static` over a plain node HTTP server, so nothing
depends on a dev server being up.

To look at it by hand:

```bash
yarn workspace @variance-authority/case-storybook storybook
```

## What is in the stories

A small design system — `Button`, `Stack`, `Card`, `Spinner`, `Clock`,
`AsyncPanel`, `Panel`, `SheetLeak`, and three Suspense trees — chosen so the
thirteen stories cover the cases that actually decide whether an adapter is any
good. Twelve of them are subjects; the thirteenth is tagged `no-variance` and is
a cause rather than a subject, which the table below says why about.

The eleven stable stories are collected through **one navigation**; the deferred
and ticking stories are exercised separately:

| story | what it is for |
|---|---|
| `Button — primary`, `Button — secondary` | the ordinary path |
| `Card — with actions`, `Card — rebranded token`, `Stack — composed page` | `Button` again, so no subject covers it alone — these five are what a `Button` edit moves |
| `Spinner — mid animation` | something that will not hold still |
| `Clock — ticking` | content that changes because time passed, not because code did |
| `AsyncPanel — settles late` | settles *after* Storybook says it is done |
| `Panel — revealed by its play function` | a subject that does not exist until an interaction runs |
| `Suspense — settles` | a boundary no marker could cover: the component that would carry one has not rendered |
| `Suspense — waterfall` | a boundary that only exists once the first one resolves, so one clean reading is not enough |
| `Sheet — left in the document` | leaves a rule in the document, so the next story read in the same page is a different subject — the case `collectAlone` exists for, and the reason it is tagged out of the run |
| `Suspense — stalled` | a boundary that never resolves, which is a flake source and is refused unless declared |

Those last seven are the seven that hold when `Button` changes.

## A flake is diagnosed, not retried away

`Clock — ticking` agrees with its baseline but changes between two readings of
the same built story. A normal run settles at the baseline before it needs a
second read; the diagnostic sweep asks the other question.

```bash
yarn build
yarn workspace @variance-authority/case-storybook build-storybook
yarn workspace @variance-authority/case-storybook build-storybook:changed
yarn vitest run cases/storybook-case/src/cli.chromium.test.js
```

The case drives `variance run --flakes` for that one story and proves an
`unchanged` verdict can still carry an `unstable` diagnosis for the named ticking
story. The run exits **1**. A following `variance accept` refuses the
candidate—there are two readings and neither may become the baseline—then exits
**2** because the requested acceptance has no safe action.

**Boundary:** this is one timer, one Chromium environment, and one immediate
second read. It does not measure recurrence, a fleet-wide flake rate, or
cross-machine rasterization.

## Order dependence is separated from a regression

`Sheet — left in the document` renders correctly, settles immediately, and
appends a rule to the document that it never takes back. Every story read after
it *in the same page* is read through that rule, so `Card — with actions` grows —
and the comparison says its pixels moved, which is what an edit to `Button` also
says.

```bash
yarn workspace @variance-authority/case-storybook build-storybook
yarn vitest run cases/storybook-case/src/alone.chromium.test.js
```

The card is collected five times through the shipped collector: twice before the
leaking story runs, once out of a browser nothing else has touched, then again
in the page that story went through, then alone once more. The clean subject
reads identically alone and in company — same viewport, same fonts, same source
index, and the same static server, so the same environment key — and the
polluted one does not, until it is read alone. That gap is `collectAlone`, and it
is what a run reports as `order-dependent` rather than offering the difference to
somebody to accept.

The leaking story carries `no-variance`, so it is a cause the case runs and never
a subject the case records.

## Readiness is a declared contract

`AsyncPanel` demonstrates the readiness gap, **reproducibly rather than
flakily**:

- with Storybook's own `storyRendered` signal, the capture is of `loading…`
- with a declared `readySelector`, the capture is of the component

Which is the whole argument for a declared marker over a framework signal, made
by a component rather than by an assertion. A story that never attaches its
marker times out and says which selector it waited for — there is no fallback,
because falling back is how you photograph a spinner and call it a component.

## Driving the CLI end to end

The adapter reads a Storybook. This runs the whole tool over one.

```bash
yarn workspace @variance-authority/case-storybook build-storybook
yarn workspace @variance-authority/case-storybook build-storybook:changed
yarn build
```

```bash
yarn vitest run cases/storybook-case/src/cli.chromium.test.js
```

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
