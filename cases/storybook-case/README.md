# storybook-case

**A real Storybook, built by Storybook, read from the outside.**

Not a fixture shaped like one. `storybook build` produces `storybook-static/` and
the adapter is pointed at the `index.json` that Storybook wrote — because an
adapter tested against an index *we* wrote is an adapter tested against our own
assumptions about the format.

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
`AsyncPanel` — chosen so the eight stories cover the cases that actually decide
whether an adapter is any good:

| story | what it is for |
|---|---|
| static components | the ordinary path: eight stories, **one navigation** |
| `Spinner` | something that will not hold still |
| `Clock` | content that changes because time passed, not because code did |
| `AsyncPanel` | settles *after* Storybook says it is done |
| a story that throws | an error overlay, reported with the story's own stack |

## The finding this case exists to have produced

`AsyncPanel` demonstrates the readiness gap, **reproducibly rather than
flakily**:

- with Storybook's own `storyRendered` signal, the capture is of `loading…`
- with a declared `readySelector`, the capture is of the component

Which is the whole argument for a declared marker over a framework signal, made
by a component rather than by an assertion. A story that never attaches its
marker times out and says which selector it waited for — there is no fallback,
because falling back is how you photograph a spinner and call it a component.

## What it caught on the way in

`React is not defined` — a missing `esbuild.jsx: 'automatic'` in `viteFinal`. The
adapter reported it as `errored` with the story's own stack rather than as a
timeout, which is the behaviour it was built for, arriving unprompted.
