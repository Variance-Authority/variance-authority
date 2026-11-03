// compass: variance-authority.reach
/**
 * Where a pull request's drift from the walk left the baseline's (spec 0105).
 *
 * A record is layered, so a test file's rows can be an older commit's than the
 * record's own, and a row read against a walk it was not recorded on is a
 * false row. So a test file is compared only where both sides observed it
 * whole at their own commit; every other one is counted under its reason and
 * never compared, and absence selects nothing.
 */
import { codeUnitOrder } from '@variance-authority/core/segment';
import type { DriftRow } from './drift.js';


/** One side's drift, with the test files it observed whole at its commit and every test file its record holds. */
export interface DriftSide {
  readonly rows: readonly DriftRow[];
  readonly observed: ReadonlySet<string>;
  readonly held: ReadonlySet<string>;
}

/** Why a test file was not compared. */
export type NotCompared = 'not observed at the head' | 'not observed at the baseline' | 'no merge-base walk';

const REASONS: readonly NotCompared[] = ['not observed at the head', 'not observed at the baseline', 'no merge-base walk'];

/** Where the head's drift left the baseline's, and every test file not compared, under its reason. */
export interface DriftChange {
  /** How many test files were compared. */
  readonly compared: number;
  /** Rows the baseline lacks, of the test files compared. */
  readonly grown: DriftRow[];
  /** Baseline rows the run lacks, of the test files compared. */
  readonly shrunk: DriftRow[];
  /** The drift of test files the baseline does not hold: what they record first, not grown. */
  readonly first: DriftRow[];
  /** Baseline test files the tree no longer holds. */
  readonly removed: string[];
  readonly notCompared: { readonly reason: NotCompared; readonly tests: string[] }[];
}

export interface DriftChangeOptions {
  /** Whether the checkout holds this test file. */
  readonly present: (test: string) => boolean;
  /** The baseline test files the merge base's walk could not read, with the file it stopped at. */
  readonly unread?: ReadonlyMap<string, string>;
}

/** `head`'s drift against `base`'s, test file by test file. */
export function driftChange(base: DriftSide, head: DriftSide, { present, unread = new Map() }: DriftChangeOptions): DriftChange {
  const baseRows = byTest(base.rows);
  const headRows = byTest(head.rows);
  const skipped = new Map<NotCompared, string[]>();
  const skip = (reason: NotCompared, test: string) => {
    const tests = skipped.get(reason);
    if (tests === undefined) skipped.set(reason, [test]);
    else tests.push(test);
  };
  const grown: DriftRow[] = [];
  const shrunk: DriftRow[] = [];
  const first: DriftRow[] = [];
  const removed: string[] = [];
  let compared = 0;

  for (const test of [...new Set([...base.held, ...head.held, ...head.observed])].sort(codeUnitOrder)) {
    if (!head.observed.has(test)) {
      if (!present(test) && base.held.has(test)) removed.push(test);
      else skip('not observed at the head', test);
    } else if (!base.held.has(test)) {
      for (const file of headRows.get(test) ?? []) first.push({ file, test });
    } else if (!base.observed.has(test)) {
      skip('not observed at the baseline', test);
    } else if (unread.has(test)) {
      skip('no merge-base walk', test);
    } else {
      compared += 1;
      const was = baseRows.get(test) ?? new Set();
      const now = headRows.get(test) ?? new Set();
      for (const file of now) if (!was.has(file)) grown.push({ file, test });
      for (const file of was) if (!now.has(file)) shrunk.push({ file, test });
    }
  }
  const order = (a: DriftRow, b: DriftRow) => codeUnitOrder(a.test, b.test) || codeUnitOrder(a.file, b.file);
  return {
    compared,
    grown: grown.sort(order),
    shrunk: shrunk.sort(order),
    first: first.sort(order),
    removed,
    notCompared: REASONS.flatMap((reason) => (skipped.has(reason) ? [{ reason, tests: skipped.get(reason)! }] : [])),
  };
}

function byTest(rows: readonly DriftRow[]): Map<string, Set<string>> {
  const files = new Map<string, Set<string>>();
  for (const { file, test } of rows) {
    const of = files.get(test);
    if (of === undefined) files.set(test, new Set([file]));
    else of.add(file);
  }
  return files;
}
