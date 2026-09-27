import { Button, Card, SheetLeak, Stack, Tokens } from './ds.jsx';

/**
 * The composed page, and the two stories about the page rather than a component.
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
