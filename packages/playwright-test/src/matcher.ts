import { expect as base } from '@playwright/test';
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

export const expect = base.extend({
  /**
   * Passes only on `unchanged`.
   *
   * `new` fails, and that is the whole of the disagreement with every snapshot
   * matcher in this category: they write the first image they see and report
   * green. A subject nobody has approved is not a passing subject. Playwright
   * has no third outcome, so this fails and names which one it is.
   */
  toBeUnchanged(observation: Observation, options: UnchangedOptions = {}) {
    return {
      pass: observation.verdict === 'unchanged',
      message: () =>
        observation.verdict === 'unchanged'
          ? `${observation.subject}: ${observation.because}`
          : describeObservation(observation, options.source),
    };
  },
});
