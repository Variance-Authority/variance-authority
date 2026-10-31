// compass: variance-authority.reach
/**
 * Which text of an asked file the run at a test's place ran over
 * (`testPlaces`), as the record says it: the digest its landing names, the
 * committed text where it stood, or, for the one run that wrote a snapshot
 * naming no commit, the snapshot's rows. Reading the texts is the caller's; this
 * reads only what it is handed.
 */

import { digestString } from '../digest.js';
import type { Placement } from './placed.js';
import type { TestPlace } from './test-places.js';

/**
 * What one run ran over of one asked file: the held text, another, given when
 * it is found, none where the file did not exist, or why that is not known.
 */
export type RanOver = 'held' | NotHeld | { readonly unknown: string };

/** What a run ran over of a file instead of its held text: another text, given when it is found, or none. */
export type NotHeld = 'absent' | { readonly text: string | undefined };

/** What telling which text a run ran over reads, read once for every run. */
export interface RanOverEvidence {
  /** Whether the checkout is in a git repository, so a committed text can be read. */
  readonly repository: boolean;
  /** The committed text of each asked file at each run's commit, by the asked name; a file the commit lacks is absent. */
  readonly committed: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The asked files each run's commit does not hold, told from a text this clone lacks. */
  readonly absent: ReadonlyMap<string, ReadonlySet<string>>;
  /** Why git could not give an asked file's text at a run's commit, by commit and the asked name. */
  readonly refused: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The text behind each digest a run names that the record keeps, read when a line or a function is asked. */
  readonly kept: ReadonlyMap<string, string>;
  /** When the run that wrote a snapshot naming no commit landed: its rows are the record of the texts it ran over. */
  readonly last: string | undefined;
  /** How each asked file's recorded lines stand in its held text, where the snapshot holds an instrumented row of it. */
  readonly placements: ReadonlyMap<string, Placement>;
  /** Under a precondition answer: the test files whose own digest of the file is of another text. */
  readonly ranOther: ReadonlyMap<string, readonly string[]> | undefined;
}

/**
 * The run that wrote a snapshot naming no commit: the record's latest landing,
 * outside a checkout, which names no texts, so the snapshot's rows are the
 * record of which text its cases ran over. An earlier landing's rows a later
 * run may have written over.
 */
export function readsTheSnapshot(run: TestPlace, last: string | undefined): boolean {
  return last !== undefined && run.commit === undefined && run.texts === undefined && run.assumed !== true && run.latest === last;
}

/**
 * Whether `run` ran over `text` of `file`, the text it ran over instead when
 * that is found, or why that is not known. A run whose record names its texts
 * ran over the one it names, else over the committed one, or over none where
 * its commit lacks the file; one observed without naming them ran over a text
 * the record does not know; one the record could not place, over a text it
 * cannot say; the one that wrote a snapshot naming no commit, over its rows'.
 */
export function ranOver(run: TestPlace, test: string, file: string, text: string, evidence: RanOverEvidence, precondition: boolean): RanOver {
  if (run.assumed === true) return { unknown: `the record does not say where that run stood, so not which text of ${file} it ran over` };
  if (readsTheSnapshot(run, evidence.last)) return fromSnapshot(test, file, evidence, precondition);
  if (run.texts === undefined) return { unknown: `the runs record does not say which text of ${file} its runs there ran over` };
  const digest = digestString(text);
  const committed = run.commit === undefined ? undefined : evidence.committed.get(run.commit)?.get(file);
  const named = run.texts[file];
  if (named !== undefined) {
    if (named === digest) return 'held';
    return { text: evidence.kept.get(named) ?? (committed !== undefined && digestString(committed) === named ? committed : undefined) };
  }
  if (committed !== undefined) return digestString(committed) === digest ? 'held' : { text: committed };
  if (run.commit !== undefined && evidence.absent.get(run.commit)?.has(file) === true) return 'absent';
  const refused = run.commit === undefined ? undefined : evidence.refused.get(run.commit)?.get(file);
  if (refused !== undefined) return { unknown: `git could not give the text of ${file} where that run stood: ${refused}` };
  // A run outside a checkout names no texts (`ranOverTexts`), so one that names them stood at a commit.
  return {
    unknown: evidence.repository
      ? `this clone holds no committed text of ${file} where that run stood`
      : `the checkout is in no git repository, so no committed text of ${file} can be read`,
  };
}

/**
 * The text the snapshot's rows say `test` ran over: an instrumented file's
 * row digest, through the placement of its lines in the held text, and a
 * precondition's digest, which the record keeps per test file.
 */
function fromSnapshot(test: string, file: string, evidence: RanOverEvidence, precondition: boolean): RanOver {
  if (precondition) return evidence.ranOther?.get(file)?.includes(test) === true ? { text: undefined } : 'held';
  const placement = evidence.placements.get(file);
  if (placement === undefined) return { unknown: `the record holds no digest of the text of ${file} it ran over` };
  return placement.frame === 'recorded' ? 'held' : { text: placement.recorded };
}
