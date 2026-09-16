import {
  AsyncPanel,
  Button,
  Card,
  Clock,
  Disclosure,
  SheetLeak,
  Spinner,
  Stack,
  StalledFeed,
  SuspendedRoster,
  SuspendedWaterfall,
  Tokens,
} from './ds.jsx';

/**
 * Real stories in a real Storybook, written to be read by something else.
 *
 * The set is chosen so the adapter meets every shape it claims to handle: a
 * plain subject, a subject rendered more than once so component coverage
 * overlaps, three kinds of instability with three different correct answers, and
 * a token override so a single edit reaches several subjects at once.
 */

export default {
  title: 'Case/Surface',
  parameters: { layout: 'centered' },
};

export const ButtonPrimary = {
  name: 'Button — primary',
  render: () => (
    <Tokens>
      <Button>Continue</Button>
    </Tokens>
  ),
};

export const ButtonSecondary = {
  name: 'Button — secondary',
  render: () => (
    <Tokens>
      <Button variant="secondary">Cancel</Button>
    </Tokens>
  ),
};

/** Covers `Button` a third time, so no subject covers it alone. */
export const CardWithActions = {
  name: 'Card — with actions',
  render: () => (
    <Tokens>
      <Card title="Invoice">
        <Button>Pay</Button>
        <Button variant="secondary">Later</Button>
      </Card>
    </Tokens>
  ),
};

/**
 * The only subject that covers `Card` alone in the accent theme — the coverage
 * signal should say so, because deleting it removes the only thing watching it.
 */
export const CardRebranded = {
  name: 'Card — rebranded token',
  render: () => (
    <Tokens overrides={{ '--case-accent': '#b5179e', '--case-space': '16px' }}>
      <Card title="Invoice">
        <Button>Pay</Button>
      </Card>
    </Tokens>
  ),
};

/** Style instability with a named cause: `transform` on `Spinner`. */
export const Loading = {
  name: 'Spinner — mid animation',
  render: () => (
    <Tokens>
      <Spinner />
    </Tokens>
  ),
};

/** Content instability. The correct answer is the text node, not the box. */
export const Ticking = {
  name: 'Clock — ticking',
  render: () => (
    <Tokens>
      <Clock />
    </Tokens>
  ),
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

export const Composed = {
  name: 'Stack — composed page',
  render: () => (
    <Tokens>
      <Stack>
        <Card title="Invoice">
          <Button>Pay</Button>
        </Card>
        <Card title="History">
          <Button variant="secondary">Export</Button>
        </Card>
      </Stack>
    </Tokens>
  ),
};

/**
 * The story that changes what the stories after it mean.
 *
 * Everything above is a subject. This one is a *cause*: it appends a rule to
 * the document and leaves it there, so `Card — with actions` read after it in
 * the same page is a wider card than `Card — with actions` read on its own. Both
 * readings are reproducible. Neither is wrong. The comparison between them says
 * the pixels moved, which is what an edit to `Button` also says.
 *
 * `tags: ['no-variance']` keeps it out of the run, and `excludeTags` in
 * `variance.config.json` is what honours the tag. Recording a baseline for it
 * would be recording a baseline for the act of contaminating the page, and the
 * twelve subjects the case reports stay twelve.
 *
 * `src/alone.chromium.test.js` is the file that uses it, by collecting a second
 * story before and after this one runs.
 */
export const LeaksASheet = {
  name: 'Sheet — left in the document',
  tags: ['no-variance'],
  render: () => (
    <Tokens>
      <SheetLeak />
    </Tokens>
  ),
};

/**
 * The story that is still busy when the next one is asked for.
 *
 * `storyRendered` is not the end of a render. Storybook's own order is
 * `playing` → `completing` → `completed` (which is where `storyRendered` is
 * emitted) → `afterEach` → `finished` (which is where `storyFinished` is), and
 * `afterEach` counts as pending. A driver that treats `storyRendered` as the
 * finish line therefore selects the next story while this one is mid-phase, and
 * `StoryRender.teardown` answers that with three macrotask ticks of grace
 * followed by `window.location.reload()` and a promise that never resolves:
 *
 * ```js
 * for (let i = 0; i < 3; i += 1) {
 *   if (!this.isPending()) { await this.teardownRender(); return; }
 *   await new Promise((resolve) => setTimeout(resolve, 0));
 * }
 * window?.location?.reload?.(), await new Promise(() => {});
 * ```
 *
 * The reload discards everything injected into the page, so the story after this
 * one is read from a document that has been reset — which is not a slow run but
 * a run that stops observing. Nothing else in this Storybook occupies that
 * phase: there are no addons and no global decorators, deliberately, so the
 * window this story opens is a window no other subject here opens.
 *
 * Two seconds, which is far more than the three ticks the grace is measured in,
 * because the thing that has to still be pending is pending *when the driver
 * asks for the next story* — and the driver is a process away. A story that
 * settles inside the round trip out to Node and back is finished before the
 * switch and reproduces nothing: at a hundred and twenty milliseconds this
 * fixture passed with the fix removed. The number is not a race to be tuned
 * finer; it is a duration chosen to outlast a round trip on a loaded machine.
 * It is paid twice in the whole suite, by the two tests that collect this story.
 *
 * `@storybook/addon-a11y` with `test` set is the ordinary way a real project
 * gets here without writing an `afterEach` at all — it ships one, and its axe
 * scan runs in exactly this phase.
 *
 * `src/finish.chromium.test.js` is the file that uses it. `no-variance` keeps it
 * out of the run: it is a subject about the driver, not about a component, and
 * the case still reports twelve.
 */
export const FinishesLate = {
  name: 'Button — busy after render',
  tags: ['no-variance'],
  afterEach: async () => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  },
  // A label no other story uses, so a test can tell "the next story rendered"
  // apart from "the preview reloaded and restored this one".
  render: () => (
    <Tokens>
      <Button>Settling</Button>
    </Tokens>
  ),
};
