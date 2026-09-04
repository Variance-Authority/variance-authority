import type { SourceIndex } from '@variance-authority/core';
import type { Observation } from '@variance-authority/observe';
import { describeObservation } from './docket.js';

/**
 * The matcher takes an {@link Observation}, not a `Locator`.
 *
 * Every third-party Playwright matcher that takes a page ends up owning a
 * browser, a store and a bundle in module-level state, because `expect.extend`
 * cannot reach a fixture. Splitting them leaves the requirements where the
 * fixture already declares them, and leaves this a pure function of a value —
 * which is the only version testable without a browser, and
 * [`docket.test.ts`](./docket.test.ts) is where that is spent.
 */

export interface UnchangedOptions {
  /** Component to file, if the observation was made without one. */
  readonly source?: SourceIndex;
}

/** A matcher function suites may compose into an expect they already own. */
export function toBeUnchanged(observation: Observation, options: UnchangedOptions = {}) {
  return {
    pass: observation.verdict === 'unchanged',
    message: () =>
      observation.verdict === 'unchanged'
        ? `${observation.subject}: ${observation.because}`
        : describeObservation(observation, options.source),
  };
}

/**
 * Every matcher here as one object, for a suite handing the set to `expect.extend`.
 *
 * A bundle rather than a namespace, and it exists so that adding a matcher is
 * not a line every adopter has to add to their own setup file. Each member is
 * exported separately as well, because a suite that wants one matcher is
 * entitled to take one.
 */
export const varianceMatchers = { toBeUnchanged };

/** Assert without replacing the suite's existing `expect`. */
export function assertUnchanged(
  observation: Observation,
  options: UnchangedOptions = {},
): void {
  if (observation.verdict !== 'unchanged') {
    throw new Error(describeObservation(observation, options.source));
  }
}
