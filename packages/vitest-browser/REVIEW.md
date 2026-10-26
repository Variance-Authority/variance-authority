# Reviewing `@variance-authority/vitest-browser`

Gives a Vitest browser-mode test one call, `variance`, that reads the mounted
subject in the tab and sends it to the Node half, which paints it, compares it
with its baseline and answers a verdict `assertUnchanged` asserts.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/vitest-browser/`.

## Contracts

- **A subject is named, never invented.** With no `subjectId` the subject is the
  running test, its titles sent apart so a ` > ` inside one stays whole; with no
  test and no id the call refuses. Pinned by
  [src/observe.test.ts](src/observe.test.ts) › "refuses a subject with no id
  rather than inventing one" and › "sends the titles the runner declared, a
  separator inside one kept whole".
- **No baseline is `new`, and a write is a promotion.** A subject with no
  baseline is `new` and stores nothing; an accepting run promotes the image it
  painted, never a second paint, and the run still fails. Written in [README ›
  Run it and approve the first
  baseline](README.md#run-it-and-approve-the-first-baseline); pinned by
  [src/node.test.ts](src/node.test.ts) › "reports a subject with no baseline as
  new, and stores nothing" and › "promotes the image this run painted when the
  run is accepting".
- **`--update` keeps an unchanged baseline current.** An unchanged subject whose
  baseline kept no snapshot, or was painted under another identity, is
  re-stamped under this run's. Pinned by [src/node.test.ts](src/node.test.ts) ›
  "re-stamps an unchanged baseline that kept no snapshot on `--update`, so it
  keeps this one".
- **Another machine is a named cause.** A baseline painted elsewhere is
  compared, and the identity that moved is named as the cause of every change.
  Written in [README › The two
  halves](README.md#the-two-halves-and-why-the-tabs-screenshot-is-not-used);
  pinned by [src/node.test.ts](src/node.test.ts) › "compares another machine`s
  baseline and names the platform that moved".
- **Renders are cache, baselines are tracked.** The images a run paints go to
  `renders/` in the checkout's cache, pruned when the run closes, and never into
  the baseline root. Written in [README › Commit the
  baselines](README.md#commit-the-baselines); pinned by
  [src/node.test.ts](src/node.test.ts) › "paints into the checkout`s cache, and
  leaves the baseline root to baselines".
- **The frame the component was laid out in.** Media queries resolve against the
  test's iframe, not the tab. Pinned by
  [src/observe.test.ts](src/observe.test.ts) › "records the frame the subject
  was laid out in, not the tab".
- **Loading is declared both ways.** A Suspense fallback is refused unless
  declared `loading`, and a declared subject that settled is refused too.
  Written in [README › A subject that had not arrived
  yet](README.md#a-subject-that-had-not-arrived-yet).
- **Wiring is recorded, never a verdict.** Hook shape, `memo` and contexts never
  make a subject `changed`: [README › `wiring`](README.md#about-wiring).

## Where to look for a counterexample

- `src/node.ts`, where `accept`, the runner's `--update` and the baseline's
  identity meet: try `accept: false` with `-u`, an unchanged subject from
  another machine, and a changed one under a new stabilization recipe.
- `src/observe.ts`, `src/protocol.ts`: a title holding ` > `, a call outside a
  test, anything sent across that is not plain JSON.
