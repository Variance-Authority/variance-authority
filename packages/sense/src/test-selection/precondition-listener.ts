import { saidJoined, saidRow, saidSite, type CasePrecondition, type Said } from './case-said.js';
import preconditions from './case-preconditions.cjs';
import type { PageRead } from './probes.js';

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

/**
 * What a realm's cases said and what the code read in them, for a runner that
 * drives its cases from outside the realm's case scope.
 */
export interface PreconditionListener {
  /**
   * What the case `key` names said and what the code read for it since it was
   * last taken, each site named from the checkout: absent when it heard
   * nothing.
   */
  take(key: string): Said | undefined;
  /** What a case this listener heard nothing from heard: every facet empty. */
  readonly nothing: Said;
  /**
   * What a page's code read for the case `key` names, as the page's drain
   * handed it over: the runner knows which case it drained, where the
   * standing at the time of the drain may be its `afterEach`.
   */
  laid(key: string, read: readonly PageRead[]): void;
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
 * Listen for `variancePrecondition` and `varianceBreadcrumb` in this realm, for
 * a runner that names its cases and hooks itself, as Playwright's worker does.
 *
 * The call is placed by `standing`, asked at the moment of the call: the case
 * body is the case's level, a `beforeEach` its describe's. A precondition the
 * runner places on no case throws; a read it places on none is warned about.
 * The realm's files have loaded by the time a runner listens: a read is a
 * case's, or nobody's.
 *
 * @param root The checkout the sites are named from.
 */
export function listenForPreconditions(root: string, standing: () => PreconditionStanding): PreconditionListener {
  const holder = globalThis as { [key: symbol]: unknown };
  const before = holder[preconditions.PRECONDITION];
  const reading = holder[preconditions.BREADCRUMB];
  // Every call is placed by one reading of `standing`, so `running` names no case.
  const heard = preconditions.recorder(holder, () => undefined, undefined, (site) => saidSite(root, site), true);
  // FIXME: a read made while a later file of the worker loads stands outside and is
  // recorded on no case, where a Node runner lays it on every case of the file.
  heard.loaded();
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
  const give = (symbol: symbol, held: unknown): void => {
    if (held === undefined) delete holder[symbol];
    else holder[symbol] = held;
  };
  return {
    take: (key) => heardFrom(root, heard.take(key)),
    nothing: JSON.stringify({ said: [], read: [], misused: [] }),
    laid: (key, read) => heard.laid(key, read),
    held: (key) => {
      const said = heardFrom(root, { said: heard.held(key) });
      return said === undefined ? [] : (saidRow(said).said ?? []);
    },
    close: () => {
      give(preconditions.PRECONDITION, before);
      give(preconditions.BREADCRUMB, reading);
    },
  };
}

/** What a recorder held for a case, its sites named from the checkout; absent when it heard nothing. */
function heardFrom(
  root: string,
  heard: { readonly said: readonly unknown[]; readonly read?: readonly unknown[]; readonly misused?: readonly unknown[] },
): Said | undefined {
  const unheard = [heard.said, heard.read, heard.misused].every((items) => items === undefined || items.length === 0);
  return unheard ? undefined : saidJoined(root, [JSON.stringify(heard)]);
}
