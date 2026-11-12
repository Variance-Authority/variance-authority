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
import { fellTo, type LocalAnswer } from './select-local.js';
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
  /**
   * The hops of every wave this shard runs, when `beneath`: each wave places
   * them as one, so the waves together take the part the run's plan priced.
   * Absent, a wave is placed alone.
   */
  readonly placeAtDistance?: { readonly from: number; readonly to: number };
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
  /**
   * A reading that cannot narrow falls to the changed files' importers, or
   * their packages, instead of running every test file (`select-local.ts`).
   * Asked by name: a gate never sets it.
   */
  readonly local?: boolean;
  /**
   * Read the record under this checkout's own, as one shard of a run does: it
   * selects from the record it was handed, never from what it or an earlier
   * wave of it ran, so every shard and wave cut the same selection.
   */
  readonly beneath?: boolean;
}

function placingOf(span: TestSelection): NonNullable<SuiteSelection['placing']> {
  return { skip: new Set(span.skip), ...(span.only === undefined ? {} : { only: new Set(span.only) }) };
}

/** The selection, with the whole reading it was cut from, for a caller that prints it. */
export interface SuiteReading extends SuiteSelection {
  readonly reading: TestSelection;
}

/** The reading, fallen to `fell` when it widened and one is given, cut to the leg asked for, as sets. */
export function suiteOf(input: SelectInput, atDistance: Leg | undefined, fell?: LocalAnswer): SuiteReading {
  const read = skippableTests(input);
  const base = fell === undefined || read.widened === undefined ? read : fellTo(read, fell);
  const reading = inLeg(base, input, atDistance);
  const left = reading.fell?.left ?? reading.left ?? [];
  const whole = input.ground.kind === 'read' ? input.ground.narrowing.whole : [];
  return {
    whole: new Set(whole),
    skip: new Set(reading.skip),
    ...(reading.widened === undefined ? {} : { declined: reading.widened }),
    ...(left.length === 0 ? {} : { left: new Set(left) }),
    ...(reading.only === undefined ? {} : { only: new Set(reading.only) }),
    // The waves the shard was told it runs read one selection, and place it as one.
    ...(atDistance?.placing === undefined ? {} : { placing: placingOf(inLeg(base, input, { ...atDistance.placing, partition: true })) }),
    notes: reading.notes,
    reading,
  };
}
