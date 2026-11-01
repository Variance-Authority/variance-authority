import './plugin.js';
import { registered } from './registry.js';
import { peek } from './tally.js';

/**
 * A second story file, which Storybook imports only when one of its stories is
 * first shown. It reads `tally.js` as it loads, and `plugin.js` registers
 * itself in `registry.js` as it loads: on a fresh page that is a count of 0 and
 * one registration.
 */
const initial = peek();

export default {
  title: 'Isolated/Reader',
  render: () => <output>{`${initial}/${registered()}`}</output>,
};

export const Initial = {};
