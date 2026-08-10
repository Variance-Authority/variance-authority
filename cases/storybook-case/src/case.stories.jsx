import { AsyncPanel, Button, Card, Clock, Disclosure, Spinner, Stack, Tokens } from './ds.jsx';

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
