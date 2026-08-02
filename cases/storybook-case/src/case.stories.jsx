import { AsyncPanel, Button, Card, Clock, Spinner, Stack, Tokens } from './ds.jsx';

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
