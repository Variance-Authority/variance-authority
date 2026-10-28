import { saidJoined, saidRow, saidSite, type CasePrecondition, type Said } from './case-said.js';
import preconditions from './case-preconditions.cjs';

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
   * from the checkout: absent when it said nothing.
   */
  take(key: string): Said | undefined;
  /**
   * What the case `key` names has said so far, resolved as its row would be
   * if it ended now, and left for {@link take}: what a snapshot taken inside
   * the case was taken under. Empty when it has said nothing.
   */
  held(key: string): readonly CasePrecondition[];
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
  const heard = preconditions.recorder(holder, () => undefined, undefined, (site) => saidSite(root, site));
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
    take: (key) => heardFrom(root, heard.take(key).said),
    held: (key) => {
      const said = heardFrom(root, heard.held(key));
      return said === undefined ? [] : (saidRow(said).said ?? []);
    },
    close: () => {
      if (before === undefined) delete holder[preconditions.PRECONDITION];
      else holder[preconditions.PRECONDITION] = before;
    },
  };
}

/** What a recorder held for a case, its sites named from the checkout; absent when it said nothing. */
function heardFrom(root: string, said: readonly unknown[]): Said | undefined {
  return said.length === 0 ? undefined : saidJoined(root, [JSON.stringify({ said })]);
}
