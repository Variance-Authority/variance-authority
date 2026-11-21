/**
 * Declared outcomes for a test's actions, over any page a test can reach: an
 * action names where it starts and where it can end, and performing it says
 * where it did. A surface — `/dom` for a document, `/playwright` for a browser
 * page — answers the questions; the declarations are the same over both.
 *
 * It reads no signal from the app and imports nothing from the rest of
 * Variance Authority.
 */

export { action, here, region, stay, Unreached } from './model.js';
export type { Action, Declare, Declared, Ends, Outcomes, Reached, Reaching, Reason, Region } from './model.js';
export type { Elsewhere, Query, Quiet, Surface, Target } from './surface.js';
