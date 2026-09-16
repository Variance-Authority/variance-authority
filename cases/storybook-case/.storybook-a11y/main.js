import base from '../.storybook/main.js';

/**
 * The same Storybook, with the addon an ordinary project has.
 *
 * `@storybook/addon-a11y` with `test` set runs axe in `afterEach`, on every
 * story. That is the phase a session must wait out before it can switch
 * stories, and standing it down for the pass is what
 * `src/globals.chromium.test.js` checks — against the addon itself, at the
 * version this repository resolves, rather than against a description of it.
 *
 * ## Why this is a second build rather than a line in `.storybook/main.js`
 *
 * The addon changes the subject. Installed globally, it wraps every story, and
 * the props digest the collector reads off a card stops matching the one it read
 * a moment earlier — `src/alone.chromium.test.js` fails, and it fails with two
 * *different* digests in one run, so what the addon contributes is not even
 * stable between renders. That is a finding about the addon and it is not this
 * fixture's subject: `.storybook` is the Storybook every other case test reads,
 * and it stays the one deliberately built with no addons and no global
 * decorators.
 *
 * The cost is one more build, and only for the suite that needs it:
 *   yarn workspace @variance-authority/case-storybook build-storybook:a11y
 */
export default {
  ...base,
  addons: [...(base.addons ?? []), '@storybook/addon-a11y'],
};
