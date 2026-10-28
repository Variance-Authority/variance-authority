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
 * The collector fixes `Date`, and that does not help: its text counts the
 * ticks of its own timer, which the collector leaves running so a page that
 * settles on a timer still settles. Two consecutive readings of one mount
 * never agree. A baseline is another mount, and a reading agrees with it only
 * when both were taken the same 50 ms step after mounting, so a comparison
 * against a baseline is a coin flip. It has the tag `ticking`, and the case's
 * `variance.config.json` excludes it, as `cli.chromium.test.js` does for its
 * cycle, which reads this story in a sweep of its own.
 */
export const Ticking = {
  name: 'Clock — ticking',
  tags: ['ticking'],
  render: () => (
    <Tokens>
      <Clock />
    </Tokens>
  ),
};
