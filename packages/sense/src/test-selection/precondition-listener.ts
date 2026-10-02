import { checkoutSaid, type Said } from './case-precondition-column.js';
import preconditions from './case-preconditions.cjs';
import type { ObservedCase } from './observed.js';

/**
 * Where a runner stands when a case says what it arranged, as only the runner
 * knows it.
 *
 * - `case`: the body of the case `key` names.
 * - `beforeEach`: a `beforeEach` running for the case `key` names, declared
 *   `depth` describes deep.
 * - `after`: an `afterEach` or `afterAll`, which is not Arrange.
 * - `unplaced`: somewhere the runner cannot name the cases a call reaches;
 *   `because` finishes the sentence that reports it.
 */
export type PreconditionStanding =
  | { readonly at: 'case'; readonly key: string }
  | { readonly at: 'beforeEach'; readonly key: string; readonly depth: number }
  | { readonly at: 'after' }
  | { readonly at: 'unplaced'; readonly because: string };

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
 * cannot place is reported with its site and laid on no case.
 *
 * @param root The checkout the sites are named from.
 */
export function listenForPreconditions(root: string, standing: () => PreconditionStanding): PreconditionListener {
  const holder = globalThis as { [key: symbol]: unknown };
  const before = holder[preconditions.PRECONDITION];
  const heard = preconditions.recorder(
    holder,
    () => {
      const at = standing();
      return at.at === 'case' ? at.key : undefined;
    },
    // Only a declared scope is matched against a name, and nothing here declares one.
    () => ({ file: '', name: '' }),
  );
  heard.where.ask = () => {
    const at = standing();
    switch (at.at) {
      case 'case':
        return undefined;
      case 'beforeEach':
        return { kind: 'each', depth: at.depth, case: at.key };
      case 'after':
        return { kind: 'after' };
      case 'unplaced':
        return {
          kind: 'held',
          hold(said: Said) {
            for (const site of new Set(said.map((entry) => entry[2]))) {
              console.warn(`variance-authority: variancePrecondition at ${site} ${at.because} and is recorded on no case`);
            }
          },
        };
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
