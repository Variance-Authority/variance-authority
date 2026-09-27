import { AsyncPanel, Disclosure, StalledFeed, SuspendedRoster, SuspendedWaterfall, Tokens } from './ds.jsx';

/**
 * Subjects that are only themselves after something settles: a late render, a play function, and three Suspense boundaries.
 *
 * One of the case's five story files. They share the title `Case/Surface`, so
 * every story id is what it was when they were one file, and the split is what
 * gives `variance run --shard` a file to place: every story one file declares
 * goes to the same shard.
 */

export default {
  title: 'Case/Surface',
  parameters: { layout: 'centered' },
};

/**
 * Settles after the framework's render event and declares it.
 *
 * Captured on `storyRendered` this is a grey box reading "loading…". Captured on
 * the declared marker it is the component. The two are each reproducible, which
 * is what makes the wrong one dangerous rather than flaky.
 */
export const Deferred = {
  name: 'AsyncPanel — settles late',
  render: () => (
    <Tokens>
      <AsyncPanel />
    </Tokens>
  ),
};

/**
 * A story whose subject only exists *after* an interaction.
 *
 * The Chromatic-parity case, and the one that separates "captured the story"
 * from "captured what the story is about": before the play function runs this
 * subject is a closed panel, and a capture taken at render time would be of the
 * wrong page while looking entirely correct.
 *
 * No import from a testing library. The play function is a plain async function
 * over the canvas element, which is all Storybook requires — and it keeps this
 * case free of a dependency whose absence would be indistinguishable from the
 * feature not working.
 */
export const Revealed = {
  name: 'Panel — revealed by its play function',
  render: () => (
    <Tokens>
      <Disclosure />
    </Tokens>
  ),
  play: async ({ canvasElement }) => {
    canvasElement.querySelector('[data-testid="reveal"]')?.click();
    // One frame, so React has committed before the story is declared rendered.
    await new Promise((resolve) => setTimeout(resolve, 0));
  },
};

/**
 * Suspends, and declares nothing — because there is nothing left to declare on.
 *
 * `Deferred` above renders its own placeholder, so its own markup can carry the
 * marker that says it finished. A component that *suspends* renders nothing:
 * what is on screen belongs to the boundary above it, and no selector, no
 * `storyRendered` and no quiescence check can be attached to a component that
 * does not exist yet. The run waits on the boundary's fiber instead, and this
 * story is the one that proves it did — captured on the framework's own event
 * it is a dashed grey box.
 */
export const SuspenseSettles = {
  name: 'Suspense — arrives late',
  render: () => (
    <Tokens>
      <SuspendedRoster />
    </Tokens>
  ),
};

/**
 * The case one clean reading gets wrong.
 *
 * When the outer promise settles, the tree holds one boundary and it is showing
 * children. React then commits those children and an inner `<Suspense>` appears
 * already showing its fallback — a boundary that did not exist a moment earlier.
 * A wait that stopped at the first clean reading captures "loading lines…", and
 * only on the machines where the timing lands that way.
 */
export const SuspenseWaterfall = {
  name: 'Suspense — boundary inside a boundary',
  render: () => (
    <Tokens>
      <SuspendedWaterfall />
    </Tokens>
  ),
};

/**
 * Never resolves — and is *declared* a loading capture in `collector/index.mjs`.
 *
 * Both halves are the example. Undeclared, this story is refused: the run names
 * the boundary, says which component wrote it, calls it a flake source and exits
 * without a baseline, because a subject that records a skeleton on a slow
 * machine and a component on a fast one is a flake nobody wrote. Declared, the
 * fallback is the subject and the capture is deliberate — which is the only way
 * past, and is why the case's own cycle stays green with this story in it.
 *
 * `src/suspense.chromium.test.js` runs it both ways.
 */
export const SuspenseStalled = {
  name: 'Suspense — never resolves',
  render: () => (
    <Tokens>
      <StalledFeed />
    </Tokens>
  ),
};
