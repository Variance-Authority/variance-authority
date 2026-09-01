/**
 * The listener a driver puts in a page, as source rather than as a module.
 *
 * It is a string because it has to run before the application does, in a realm
 * that has no module graph yet — `addInitScript` and its equivalents take source,
 * and anything imported here would be a bundle the adopter has to build. Nothing
 * in the page is touched: the application already calls `vae`, the sink appears
 * underneath it, and a build that shipped without a listener is the same build.
 */

import { WIRE_SINK } from '@variance-authority/wire';
import { EVENT_SINK } from './index.js';

/**
 * Source that installs the page's sink.
 *
 * Evaluate it before navigation. It re-runs per document, which is right: a
 * document that goes away takes its sink with it, and the driver's log is what
 * survives the navigation.
 *
 * The carrier is read at announcement time rather than captured at install time,
 * so this and the wire's own source may be evaluated in either order, and
 * announcements made before a carrier exists are held rather than dropped — a
 * decision taken during the first evaluation of the first script is exactly the
 * one a test most wants and the one a captured reference would lose.
 */
export function eventCollectorSource(): string {
  return `(() => {
  const held = [];
  globalThis[${JSON.stringify(EVENT_SINK)}] = (phase, location, subject, action) => {
    const carrier = globalThis[${JSON.stringify(WIRE_SINK)}];
    const said = { phase, location, subject, action };
    if (typeof carrier !== 'function') {
      held.push(said);
      return;
    }
    while (held.length > 0) carrier(undefined, 'events', held.shift());
    carrier(undefined, 'events', said);
  };
})();`;
}
