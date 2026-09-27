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

/**
 * Read at two widths because the story says so, not because the run config does.
 *
 * The index carries no parameters, so the only way this story becomes two
 * subjects is the collector asking the running preview what the story declared.
 * Laid out padded rather than centred, so the card is as wide as the page and
 * each width paints a different image. No `Button` inside, so the `wide-button`
 * build leaves both widths unchanged and the changed-subject list stays about
 * the edit.
 */
export const ReceiptAtTwoWidths = {
  name: 'Card — receipt at two widths',
  parameters: { layout: 'padded', variance: { widths: [375, 800] } },
  render: () => (
    <Tokens>
      <Card title="Receipt">
        <span>Paid in full</span>
      </Card>
    </Tokens>
  ),
};

/** Asks not to be read, in its own parameters, and is reported as excluded rather than dropped. */
export const ReceiptNotRead = {
  name: 'Card — receipt not read',
  parameters: { variance: { exclude: true } },
  render: () => (
    <Tokens>
      <Card title="Receipt">
        <span>Refunded</span>
      </Card>
    </Tokens>
  ),
};
