import { Button, Tokens } from './ds.jsx';

/**
 * Button on its own, twice, so no subject covers it alone.
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
