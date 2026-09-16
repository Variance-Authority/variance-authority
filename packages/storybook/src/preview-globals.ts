import type { GlobalsRequest } from './preview-protocol.js';

/**
 * Telling the preview's addons to stand down for this pass.
 *
 * A visual pass and an accessibility pass ask different questions of the same
 * story, and Storybook lets both be answered in one render: with `test` set,
 * `@storybook/addon-a11y` runs an axe scan in `afterEach`, on every story. For a
 * run that is collecting pixels that scan is time spent on a result nobody
 * reads — and it is spent in the one phase a session has to wait out before it
 * can switch stories, so it is paid twice.
 *
 * So the session says so, once, in the addon's own vocabulary: `a11y.manual`
 * is the switch the manager's own panel flips. Nothing is disabled in the
 * project, no configuration is edited, and the next run of the project's own
 * accessibility suite is unaffected — a global set over the channel lives in the
 * document this session opened and dies with it.
 *
 * Serialized to source text and evaluated in page scope, so it may close over
 * nothing and import nothing but types; the event name and the globals both
 * arrive in the argument. `preview-protocol.ts` holds the declarations and says
 * why the default is the a11y switch and nothing else.
 */

/**
 * Set globals on the running preview. **Runs in page scope.**
 *
 * Returns whether there was a channel to say it on. `false` is not an error: a
 * preview with no channel cannot be driven in place at all, which the driver
 * already knows by another route.
 */
export const applyGlobals = (request: GlobalsRequest): boolean => {
  const scope = window as unknown as {
    __STORYBOOK_PREVIEW__?: { channel?: { emit(event: string, payload: unknown): void } };
    __STORYBOOK_ADDONS_CHANNEL__?: { emit(event: string, payload: unknown): void };
  };

  const channel = scope.__STORYBOOK_PREVIEW__?.channel ?? scope.__STORYBOOK_ADDONS_CHANNEL__ ?? null;
  if (channel === null) return false;

  channel.emit(request.event, { globals: request.globals });
  return true;
};
