# Reviewing `@variance-authority/react`

Reads which React components put a DOM node there, how they are wired, what
they hold, and whether a root has committed, from the fiber `react-dom` wrote,
without importing React. `dom`'s `collect` takes its readers as providers;
`route-collector` and `storybook-collector` wait on its arrival readers.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/react/`.

## Contracts

- **No fiber is a reason, never an empty chain.** A node React never rendered,
  one unmounted and one under an uncommitted root give `no-fiber` with
  `no-client-fiber`, `unmounted` or `uncommitted`. Written in the
  [README](README.md#limits) and pinned by
  [`src/provenance.test.ts`](src/provenance.test.ts) › "returns the documented
  sentinel for a plain DOM element" and
  [`src/hydration.test.ts`](src/hydration.test.ts) › "reads no component off a
  node whose root has not committed".
- **A renamed React field reads as not committed.** Pinned by
  [`src/root-state.test.ts`](src/root-state.test.ts) › "reads a hydrating root
  as not committed when `isDehydrated` is renamed".
- **A props digest excludes `children` and agrees across records.** The owner
  frame and the commit updater frame give one digest for one instance; a
  digest pass never carries an answer into the next. Pinned by
  [`src/provenance.test.ts`](src/provenance.test.ts) › "excludes children so a
  descendant change does not move an ancestor digest" and
  [`src/props.test.tsx`](src/props.test.tsx) › "agrees between an owner frame
  and a commit updater frame for one instance" and "does not carry an answer
  into the next pass".
- **Arrival has three states, and no clock decides hydration.** A page with
  no React is `unobserved`, never `settled`; `awaitHydration` waits only while
  React has work or something is arriving. Written in the
  [README](README.md#waiting-for-a-subject-to-arrive) and pinned by
  [`src/suspense.test.tsx`](src/suspense.test.tsx) › "reports a node React
  never rendered as unobserved, not as settled" and
  [`src/root-state.test.ts`](src/root-state.test.ts) › "counts a commit React
  has held back as work".
- **A late tap refuses rather than reporting silence.** Pinned by
  [`src/commits.test.tsx`](src/commits.test.tsx) › "refuses rather than
  reporting silence when React already mounted".
- **A bound is reported, never a short answer.** Written in the
  [README](README.md#component-level-quiet) and pinned by
  [`src/traversal.test.ts`](src/traversal.test.ts) › "reports a bound instead
  of returning a quietly partial walk".
- **Holding is written into no hash, and never guesses from the DOM.**
  Written in the [README](README.md#what-else-the-same-fiber-answers) and
  [README](README.md#limits).

## Where to look for a counterexample

- `root-state.ts` and `hydration.ts`: a React release that renames a root or
  lane field, a transition-hydrated shell, a portal out of its root.
- `holding.ts`: a hook that builds no cell or two shifts every later name.
- `props.ts`: a `digestPass` reused across captures reads stale contents.
