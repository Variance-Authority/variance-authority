import { Button, Card, Tokens } from './ds.jsx';

/**
 * Card, with the token override that reaches several subjects from one edit.
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
