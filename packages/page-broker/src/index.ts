/**
 * Declared outcomes for a Playwright test's actions: an action names where it
 * can end, and performing it says where it did.
 *
 * It composes Playwright's locators and answers nothing about them. It reads no
 * signal from the app and imports nothing from the rest of Variance Authority.
 */

export { action, stay } from './action.js';
export type { Action, Declare, Outcomes, Reached, Reaching, Recogniser } from './action.js';
