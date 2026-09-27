/**
 * `@variance-authority/core/share` — one machine's evaluation, reachable from another.
 *
 * A run derives a great deal that is not about the run: what the suite is made
 * of, which subjects exist, every name each one carries, which files declare
 * which components. All of it is a fact about a *commit*, and all of it is
 * expensive — a source scan, a browser, a composition pass — while being
 * identical on every machine that starts from the same tree.
 *
 * So the second machine should not derive it again. A pull-request runner wants
 * what mainline already knows, and mainline already knew it an hour ago on a
 * runner that has since been destroyed. This module is the seam between those
 * two: a `LineCell` holds the latest of what one mainline or one branch
 * published, `publishLine` replaces it, and `readLine` reads it back
 * with the reason when it cannot.
 *
 * ## What this is not
 *
 * Not a baseline store. A baseline is the thing a comparison is *against*, it
 * cannot be re-derived, and losing one silently is how a suite records whatever
 * happened to be on screen — which is why
 * [`RasterStore`](../../../raster/src/store.ts) throws on every failure. A line
 * holds what can be derived again from the commit it names, so a miss costs the
 * derivation. The two are configured separately because they are answers to
 * different questions, and a share is disposable in a way a baseline may never
 * be.
 */

export * from './line.js';
export * from './publish.js';
export * from './http-line.js';
