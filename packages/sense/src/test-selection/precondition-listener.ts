import { checkoutSaid } from './case-precondition-column.js';
import preconditions from './case-preconditions.cjs';
import type { ObservedCase } from './observed.js';

/**
 * Where a runner stands when a case says what it arranged, as only the runner
 * knows it.
 *
 * - `case`: the body of the case `key` names.
 * - `beforeEach`: a `beforeEach` running for the case `key` names, declared
 *   `depth` describes deep.
 * - `after`: an `afterEach`, which runs for its case and is not Arrange.
 * - `outside`: no case is running — a `beforeAll`, an `afterAll`, the file
 *   collecting — and the call throws; `because` finishes the sentence it throws.
 */
export type PreconditionStanding =
  | { readonly at: 'case'; readonly key: string }
  | { readonly at: 'beforeEach'; readonly key: string; readonly depth: number }
  | { readonly at: 'after' }
  | { readonly at: 'outside'; readonly because: string };

/** What a realm's cases said, for a runner that drives its cases from outside the realm's case scope. */
export interface PreconditionListener {
  /**
   * What the case `key` names said since it was last taken, each site named
   * from the checkout, as {@link ObservedCase.said} carries it: empty when it
   * said nothing.
   */
  take(key: string): NonNullable<ObservedCase['said']>;
  /** Stop listening, and give the realm back whatever listened before. */
  close(): void;
}

/**
 * Listen for `variancePrecondition` in this realm, for a runner that names
 * its cases and hooks itself, as Playwright's worker does.
 *
 * The call is placed by `standing`, asked at the moment of the call: the case
 * body is the case's level, a `beforeEach` its describe's. A call the runner
 * places on no case throws.
 *
 * @param root The checkout the sites are named from.
 */
export function listenForPreconditions(root: string, standing: () => PreconditionStanding): PreconditionListener {
  const holder = globalThis as { [key: symbol]: unknown };
  const before = holder[preconditions.PRECONDITION];
  // Every call is placed by one reading of `standing`, so `running` names no case.
  const heard = preconditions.recorder(holder, () => undefined, undefined, root);
  heard.where.ask = () => {
    const at = standing();
    switch (at.at) {
      case 'case':
        return { kind: 'each', depth: preconditions.CASE_LEVEL, case: at.key };
      case 'beforeEach':
        return { kind: 'each', depth: at.depth, case: at.key };
      case 'after':
        return { kind: 'after' };
      case 'outside':
        return { kind: 'outside', because: at.because };
    }
  };
  return {
    take: (key) => checkoutSaid(root, heard.take(key)),
    close: () => {
      if (before === undefined) delete holder[preconditions.PRECONDITION];
      else holder[preconditions.PRECONDITION] = before;
    },
  };
}
