/**
 * The checkout's file graph as a run sees it: the scan's records with the mocks
 * read and any configured taint joined on.
 *
 * Every reader that walks the checkout's graph to say what a change reaches —
 * `variance covering --since`, `variance select`, an MCP host's source tree —
 * builds it here, so a case whose file mocked a module is cut the same way
 * whichever of them asks.
 */
// compass: variance-authority.reach
import { relationsOfFiles, type FileRecord, type Relations, type Uses } from '@variance-authority/core/relate';
import { taintRecords, type Taint, type TaintOptions } from './index.js';
import { mockTaint } from './mocks.js';

export interface RunGraphOptions extends TaintOptions {
  /** Taints a person configured, joined after the mocks. */
  readonly taints?: readonly Taint[];
  /** `[dependent, dependency]` pairs between packages, from the lockfile. */
  readonly depends?: Iterable<readonly [string, string]>;
  /**
   * How each file uses what its parse says it imports. An edge a taint added
   * was never parsed, so the names bound on it say nothing and the edge is
   * read as used whole.
   */
  readonly uses?: Uses;
}

/**
 * The graph with the mocks read unasked. A graph that believes `vi.mock('./api')`
 * imports `./api` selects that test for every change behind the mock, and an
 * operator who has to know to switch the reader on is one who finds out from
 * the suite that ran. The scan recorded what each file mocks in its parse, so
 * the mock taint opens nothing when the parse cache is passed.
 */
export async function runGraphOf(records: readonly FileRecord[], options: RunGraphOptions): Promise<Relations> {
  const { taints = [], depends, uses, ...taintOptions } = options;
  const tainted = await taintRecords(records, [mockTaint(), ...taints], taintOptions);
  const read: Uses | undefined =
    uses === undefined
      ? undefined
      : (importer, target) => (tainted.additions.get(importer)?.includes(target) ? undefined : uses(importer, target));

  return relationsOfFiles(tainted.records, {
    shadows: tainted.shadows,
    ...(depends === undefined ? {} : { depends }),
    ...(read === undefined ? {} : { uses: read }),
  });
}
