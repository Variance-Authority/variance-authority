/**
 * The listener a driver puts in a page, as source rather than as a module.
 *
 * It is a string because it has to run before the application does, in a realm
 * that has no module graph yet — `addInitScript` and its equivalents take source,
 * and anything imported here would be a bundle the adopter has to build. Nothing
 * in the page is touched: the application already calls `vae`, the sink appears
 * underneath it, and a build that shipped without a listener is the same build.
 */

import { EVENT_SINK } from './index.js';

/** The channel a driver exposes in the page to receive announcements. */
export const EVENT_REPORT = '__VAE_REPORT__';

/**
 * Source that installs the page's sink.
 *
 * Evaluate it before navigation. It re-runs per document, which is right: a
 * document that goes away takes its sink with it, and the driver's log is what
 * survives the navigation.
 *
 * The channel is read at announcement time rather than captured at install time,
 * so the two halves may be installed in either order, and announcements made
 * before the channel exists are held rather than dropped — a decision taken
 * during the first evaluation of the first script is exactly the one a test most
 * wants and the one a captured reference would lose.
 */
export function eventCollectorSource(): string {
  return `(() => {
  const held = [];
  globalThis[${JSON.stringify(EVENT_SINK)}] = (phase, location, subject, action) => {
    const report = globalThis[${JSON.stringify(EVENT_REPORT)}];
    if (typeof report !== 'function') {
      held.push({ phase, location, subject, action });
      return;
    }
    while (held.length > 0) report(held.shift());
    report({ phase, location, subject, action });
  };
})();`;
}
