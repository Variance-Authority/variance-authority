import base from '../.storybook/preview.js';

/**
 * The base preview, plus the parameter that makes the addon do anything.
 *
 * Without `test`, `@storybook/addon-a11y`'s `afterEach` returns immediately and
 * this build would have the addon installed without having the phase the addon
 * is here to put work in. `todo` reports violations without failing the story,
 * which is what a project adopting the addon on an existing component library
 * actually sets.
 */
export default {
  ...base,
  parameters: {
    ...base.parameters,
    a11y: { test: 'todo' },
  },
};
