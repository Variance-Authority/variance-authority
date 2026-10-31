import { tally } from './tally.js';

/**
 * Each story counts once, in a loader, so the number on screen is how many
 * stories before it in the same session wrote to `tally.js`.
 */
export default {
  title: 'Isolated/Tally',
  loaders: [() => ({ count: tally() })],
  render: (_args, { loaded }) => <output>{loaded.count}</output>,
};

export const First = {};
export const Second = {};
export const SharedFirst = { parameters: { sharedModules: true } };
export const SharedSecond = { parameters: { sharedModules: true } };
