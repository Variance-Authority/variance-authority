/**
 * The one answer every caller of the selection reads: `variance select`, which
 * formats it, and a runner's seam, which drops what it may skip.
 *
 * The reading is the decision in [`select.ts`](./select.ts), cut to a leg by
 * [`select-leg.ts`](./select-leg.ts). The answer a runner acts on is that
 * reading as sets of repository-relative test files: which the record holds
 * whole, and which of those no changed line reached. How a runner names,
 * matches or shards a file is its seam's question, never this one's.
 */

import type { Relations } from '@variance-authority/core/relate';
import type { SuiteSelection } from '@variance-authority/sense/test-selection';
import { inLeg, type Leg } from './select-leg.js';
import { skippableTests, type SelectInput, type TestSelection } from './select.js';

/** What `selectSuite` is asked: the checkout, the base, the suite and the leg. */
export interface SuiteRequest {
  /** A directory inside the checkout whose record and change are read. */
  readonly root: string;
  /** Where to measure from when the record names no commit of its own. */
  readonly since?: string;
  /** Whose record is read, when more than one suite is declared. */
  readonly suite?: string;
  /** One leg of the selection, by import hops from the change. */
  readonly atDistance?: Leg;
  /** A journey file, or a snapshot by path, to read instead of the recorded one. */
  readonly execution?: string;
  /**
   * The snapshot a caller in this process already answered from, by path:
   * read as the record of `suite`, whose declared configuration still selects,
   * so one invocation asks one record and looks for no other.
   */
  readonly record?: string;
  /** The change, handed in as a patch file; `-` is stdin. */
  readonly diff?: string;
  /**
   * The change, handed in as patch text by a caller in this process, read as
   * `diff` is: a question about one file asks the selection of that file's
   * entry alone (`wholeEntry`).
   */
  readonly change?: string;
  /** The file graph, when the caller has read it already: one invocation reads it once. */
  readonly relations?: Relations;
  readonly noGit?: boolean;
  /**
   * `case` also names, in each test file that runs, the cases that ran none of
   * the change (`SuiteSelection.cases`). The file is the grain when absent.
   */
  readonly grain?: 'file' | 'case';
}

/** The selection, with the whole reading it was cut from, for a caller that prints it. */
export interface SuiteReading extends SuiteSelection {
  readonly reading: TestSelection;
}

/** The reading, cut to the leg asked for, as sets. */
export function suiteOf(input: SelectInput, atDistance: Leg | undefined): SuiteReading {
  const reading = inLeg(skippableTests(input), input, atDistance);
  const whole = input.ground.kind === 'read' ? input.ground.narrowing.whole : [];
  return {
    whole: new Set(whole),
    skip: new Set(reading.skip),
    ...(reading.widened === undefined ? {} : { declined: reading.widened }),
    notes: reading.notes,
    reading,
  };
}
