/**
 * Whether the record agrees with the taints.
 *
 * A taint says what a file's run reaches; a coverage record says what it did.
 * Where the two are both present they can be held against each other, and
 * every disagreement is a fact about one of them:
 *
 * - a module a test shadows, and the record says the test called into it — the
 *   taint is wrong about that mock, or the mock did not take. Loading is not
 *   calling: a runner evaluates the real module to shape an automock, and a
 *   test whose only crossings there were made while loading ran against the
 *   mock, which is the taint being right;
 * - a module the test reaches on the graph with none of its shadows in the
 *   way, and the record says nobody entered it for that test — an import the
 *   run never loaded, or a mock nobody has written a taint for yet;
 * - a module a test was said to import beyond its text, and the record never
 *   saw the test in it — the addition names the wrong file.
 *
 * None of these is a verdict; each is the coordinate to look at, and it carries
 * the taints whose word it was where a taint said it — a table someone wrote by
 * hand and a reader over the source are corrected in different places. Only an
 * instrumented module can testify — one with no probes was entered by nobody
 * the record can see — and only a complete observation can testify to absence,
 * so the second question is not asked of a test whose recording was partial.
 * The whole audit is optional twice over: it wants a record, which only a
 * journey produces, and it wants taints, which only a reader or a table gives.
 */

import { dependenciesOf, idOf, nodeAt, type Relations } from '@variance-authority/core/relate';
import type { TestCoverage } from '../test-selection/index.js';
import type { Tainted } from './index.js';

export type TaintDeviationKind = 'shadowed-but-entered' | 'reachable-but-not-entered' | 'added-but-not-entered';

/** One place the taints and the record disagree. */
export interface TaintDeviation {
  /** The test file whose run the disagreement is about. */
  readonly test: string;
  /** The instrumented module the two disagree over. */
  readonly module: string;
  readonly kind: TaintDeviationKind;
  /**
   * The taints that said the thing the record disagrees with, sorted.
   *
   * Absent where nothing said it — `reachable-but-not-entered` is a trail the
   * scan drew and no taint touched — and where the caller passed only the two
   * tables `movedBy` needs.
   */
  readonly taints?: readonly string[];
}

/**
 * The tables the audit reads.
 *
 * The attribution is optional because the two tables a graph needs are the two
 * a caller may have kept: an audit without it still names every disagreement,
 * and one with it names who is answerable for each.
 */
export type AuditedTaints = Pick<Tainted, 'shadows' | 'additions'> &
  Partial<Pick<Tainted, 'shadowedBy' | 'addedBy'>>;

export interface TaintAuditOptions {
  /**
   * Every name the record may hold a graph file under. Identity when absent —
   * the same seam `ExecutionNarrowingOptions.knownAs` describes.
   */
  readonly knownAs?: (file: string) => readonly string[];
}

/**
 * Every disagreement between the taints and the record, ordered by test, then
 * module, then kind.
 */
export function auditTaints(
  coverage: TestCoverage,
  relations: Relations,
  tainted: AuditedTaints,
  options: TaintAuditOptions = {},
): readonly TaintDeviation[] {
  const knownAs = options.knownAs ?? ((file: string) => [file]);
  const { entered, called, instrumented: probed } = enteredBy(coverage);
  const found: TaintDeviation[] = [];
  const say = (
    test: string,
    module: string,
    kind: TaintDeviationKind,
    by?: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>,
  ): void => {
    const taints = by?.get(test)?.get(module);
    found.push({ test, module, kind, ...(taints === undefined ? {} : { taints }) });
  };

  for (const observation of coverage.tests) {
    const test = observation.file;
    const seen = entered.get(test) ?? new Set<string>();
    const sees = (module: string): boolean => knownAs(module).some((name) => seen.has(name));
    const ran = called.get(test) ?? new Set<string>();
    const calls = (module: string): boolean => knownAs(module).some((name) => ran.has(name));
    const instrumented = (module: string): boolean => knownAs(module).some((name) => probed.has(name));

    const shadows = tainted.shadows.get(test) ?? [];
    for (const module of shadows) {
      if (calls(module)) say(test, module, 'shadowed-but-entered', tainted.shadowedBy);
    }

    for (const module of tainted.additions.get(test) ?? []) {
      if (instrumented(module) && !sees(module)) say(test, module, 'added-but-not-entered', tainted.addedBy);
    }

    if (!observation.complete) continue;
    const seed = idOf(relations, 'file', test);
    if (seed === undefined) continue;
    const avoid = shadows.map((name) => idOf(relations, 'file', name)).filter((id): id is number => id !== undefined);
    for (const id of dependenciesOf(relations, [seed], { avoid }).reached) {
      const node = nodeAt(relations, id);
      if (node === undefined || node.kind !== 'file' || node.name === test) continue;
      if (instrumented(node.name) && !sees(node.name)) say(test, node.name, 'reachable-but-not-entered');
    }
  }

  return found.sort(
    (left, right) =>
      byCodeUnit(left.test, right.test) || byCodeUnit(left.module, right.module) || byCodeUnit(left.kind, right.kind),
  );
}

interface Entered {
  /** Per test, the instrumented modules it entered: by a probe of its own or by loading. */
  readonly entered: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Per test, the instrumented modules it crossed other than while loading them.
   *
   * Absence and presence ask different things of the record. Whether a module
   * the graph reaches was entered at all counts loading, because an import the
   * run loaded is an import the run followed. Whether a mock took counts only
   * calls, because loading the real module is how a runner shapes the mock.
   */
  readonly called: ReadonlyMap<string, ReadonlySet<string>>;
  /** Every instrumented module the record holds, entered by anyone or not. */
  readonly instrumented: ReadonlySet<string>;
}

function enteredBy(coverage: TestCoverage): Entered {
  const entered = new Map<string, Set<string>>();
  const called = new Map<string, Set<string>>();
  const instrumented = new Set<string>();
  for (const module of coverage.modules) {
    if (!module.instrumented) continue;
    instrumented.add(module.file);
    for (const block of module.blocks) {
      const loaded = new Set(block.loadedBy ?? []);
      for (const test of [...block.testFiles, ...loaded]) hold(entered, test, module.file);
      for (const test of block.testFiles) if (!loaded.has(test)) hold(called, test, module.file);
    }
  }
  return { entered, called, instrumented };
}

function hold(into: Map<string, Set<string>>, test: string, file: string): void {
  const held = into.get(test) ?? new Set<string>();
  held.add(file);
  into.set(test, held);
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
