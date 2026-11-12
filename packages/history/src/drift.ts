/**
 * The arithmetic, assembled.
 *
 * One import path over three modules, because this is the path every caller
 * already holds and the split below is an argument about where a defect lives,
 * not a change to what anybody imports.
 *
 * - `./churn.js` — how often a component changed, and the four rules that make
 *   the fraction mean what it says.
 * - `./token-drift.js` — what a token's values did across the window, and what
 *   to report when they cannot be subtracted.
 * - `./sentences.js` — those results as one line each, for a reviewer deciding
 *   whether to look.
 *
 * The two halves share exactly one thing — `./instant.js`, the timestamp parse —
 * and nothing else, which is why they are separable at all.
 */

export type { ChurnInput } from './churn.js';
export { accumulateChurn } from './churn.js';

export type { DriftOptions, DriftStep, Quantity, TokenDrift } from './token-drift.js';
export { detectDrift } from './token-drift.js';

export {
  describeChurn,
  describeDrift,
  describeLastChanged,
  describeReach,
} from './sentences.js';
