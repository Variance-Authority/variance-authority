// compass: variance-authority/runtime/attention
import { declaredSuites, type ExecutionIndex, type LineRange } from '@variance-authority/sense/test-selection';
import type { Relations } from '@variance-authority/core/relate';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';
import { readExecutionFor, recordedExecutionFile } from './execution-input.js';
import { ranAsTree, recordedRegions, type RecordedRegions, type Removed } from './review-region.js';
import type { Reach, ReviewRegion } from './review.js';
import type { IndexNames } from './source-graph.js';

/** A suite that cannot be read remains visible beside the suites that can. */
export interface MissedSuite {
  readonly suite?: string;
  readonly missed: string;
  readonly unrecorded?: true;
}

/**
 * Ask every suite the root config declares, in declaration order, or the one
 * record when it declares none. A suite whose record cannot answer is kept as
 * why; a base the change cannot be diffed from is no one suite's, and fails the
 * whole reading.
 */
export async function eachSuite<T>(root: string, ask: (suite: string | undefined) => Promise<T>): Promise<(T | MissedSuite)[]> {
  const readings: (T | MissedSuite)[] = [];
  for (const suite of declaredSuites(root)?.map((declared) => declared.name) ?? [undefined]) {
    try {
      readings.push(await ask(suite));
    } catch (error) {
      if (error instanceof OperatorError && error.kind === 'undiffed') throw error;
      readings.push({
        ...(suite === undefined ? {} : { suite }),
        missed: messageOf(error),
        ...(error instanceof OperatorError && error.kind === 'unrecorded' ? { unrecorded: true as const } : {}),
      });
    }
  }
  return readings;
}

/**
 * Nearest last in what a reviewer should open: nothing reached it, then reached in a text an edit wrote over, then new
 * and not run yet, then reached only from afar.
 */
export const NEAREST: readonly (Reach | 'fresh')[] = ['hole', 'unwalked', 'unknown', 'overwritten', 'fresh', 'loaded', 'unplaced', 'far', 'near'];

/** One suite's reading of one changed region. */
export interface SuitePart {
  readonly file: string;
  readonly region: ReviewRegion;
  /** Read from a run on this change, not from the record before it. */
  readonly ran: boolean;
}

/**
 * Each changed region once, answered for by the suite whose cases came nearest,
 * and between two as near by the one with more cases. A file a suite ran on the
 * change is answered by the runs on the change alone: a record from before the
 * change places the edit by its old lines, counts what the edit moved as
 * written, and its cases reached the old code.
 */
export function nearestOfEach<P extends SuitePart>(parts: readonly P[], rank: (part: P) => number = (part) => NEAREST.indexOf(part.region.reach)): P[] {
  const keyOf = (part: P) => `${part.file}\0${part.region.startLine}\0${part.region.endLine}\0${part.region.name}`;
  const ran = new Set(parts.filter((part) => part.ran).map((part) => part.file));
  const nearest = new Map<string, P>();
  for (const part of parts) {
    const key = keyOf(part);
    if (!part.ran && ran.has(part.file)) continue;
    const held = nearest.get(key);
    if (held === undefined || rank(part) > rank(held) || (rank(part) === rank(held) && part.region.cases > held.region.cases)) nearest.set(key, part);
  }
  return [...nearest.values()];
}

/**
 * Each changed file's regions read from every declared suite, for a review
 * asked for every suite's coverage.
 *
 * `own` is the named suite's answer, read from `named.index`. Another suite
 * answers for a changed file only when it ran the file as the tree holds it
 * ({@link ranAsTree}): its rows are then in the tree's lines, and a row
 * recorded over other text would name lines the change moved. The suites are joined as the handover joins them, by
 * {@link nearestOfEach}: each region is the part of the suite that came
 * nearest, and a named suite that ran the file as other text gives way to the
 * suites that ran it as the tree. When no other suite did, the named suite's
 * answer stands. A suite whose record cannot be read is left out here; the
 * coverage beside the review names it.
 */
export async function everySuiteRegions(
  root: string,
  named: { readonly suite?: string; readonly record: string; readonly index: ExecutionIndex },
  own: ReadonlyMap<string, RecordedRegions>,
  now: ReadonlyMap<string, readonly LineRange[]>,
  relations: Relations,
  removed: Removed,
  names: IndexNames,
): Promise<ReadonlyMap<string, RecordedRegions>> {
  const files = [...now.keys()];
  const readings = await eachSuite(root, async (suite) => {
    if (suite === named.suite) return undefined;
    const record = await recordedExecutionFile(root, suite);
    const { index } = await readExecutionFor(record, now);
    const ran = ranAsTree(record, files, index, names);
    if (ran.size === 0) return undefined;
    const lines = new Map([...now].filter(([file]) => ran.has(file)));
    return { ran, regions: await recordedRegions(record, index, lines, relations, root, removed) };
  });
  const others = readings.flatMap((reading) => reading === undefined || 'missed' in reading ? [] : [reading]);
  if (others.length === 0) return own;
  const ownRan = ranAsTree(named.record, files, named.index, names);
  const joined = new Map<string, RecordedRegions>();
  for (const [file, answer] of own) {
    const answers = others.flatMap((other) => other.ran.has(file) ? [other.regions.get(file)!] : []);
    if (answers.length === 0) {
      joined.set(file, answer);
      continue;
    }
    const parts = [
      ...answer.regions.map((region) => ({ file, region, ran: ownRan.has(file) })),
      ...answers.flatMap((other) => other.regions.map((region) => ({ file, region, ran: true }))),
    ];
    joined.set(file, {
      recorded: answers.some((other) => other.recorded) || (ownRan.has(file) && answer.recorded),
      regions: nearestOfEach(parts).map(({ region }) => region).sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine),
    });
  }
  return joined;
}
