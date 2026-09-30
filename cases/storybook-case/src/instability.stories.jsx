import { Clock, Spinner, Tokens } from './ds.jsx';

/**
 * Two kinds of instability, each with a different correct answer.
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

/** Style instability with a named cause: `transform` on `Spinner`. */
export const Loading = {
  name: 'Spinner — mid animation',
  render: () => (
    <Tokens>
      <Spinner />
    </Tokens>
  ),
};

/**
 * Content instability. The correct answer is the text node, not the box.
 *
 * Nothing freezes the clock, because freezing it is the author's job. So two
 * readings agree only when both land in the same 50 ms step, and a comparison
 * against a baseline is a coin flip. `unstable` is the tag a config excludes to
 * leave it out of a run that asserts `unchanged`: `cli.chromium.test.js` does
 * that for its cycle, and reads this story in a sweep of its own.
 */
export const Ticking = {
  name: 'Clock — ticking',
  tags: ['unstable'],
  render: () => (
    <Tokens>
      <Clock />
    </Tokens>
  ),
};
