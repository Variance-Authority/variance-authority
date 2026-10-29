/**
 * The selection a run with one region skipped makes inside its runner.
 *
 * A case that never entered the region cannot see it skipped, so a faulted run
 * runs the cases the record says entered it and no other. That is the case
 * grain's reading with the region as the change, so the cut is
 * {@link casesToSkip}'s, and every doubt it widens on widens here too. A file
 * the record does not hold whole runs, as it does in any selection.
 *
 * The record is the one the run lands in, which the seam names: a faulted run
 * records only into the cache its caller named (`cache-layers.ts`), so that is
 * the record the caller put there.
 */

// compass: variance-authority.reach

import type { ExecutionBlock, ExecutionIndex, SuiteSelection } from '@variance-authority/sense/test-selection';
import { readExecutionIndex } from './execution-input.js';
import { casesToSkip } from './select-cases.js';
import { suiteRecord } from './suite-record.js';

/** The region skipped: the file, by its path in the checkout, and the walk's ordinal. */
export interface FaultAddress {
  readonly file: string;
  readonly ordinal: number;
}

/** What a faulted run asks: whose record, and the address it was started with. */
export interface FaultRequest {
  readonly root: string;
  readonly suite?: string;
  /** The record the run lands in, read in place of the suite's nearest. */
  readonly record?: string;
  /** `<path>#<ordinal>`, as `VARIANCE_AUTHORITY_FAULT` spells it. */
  readonly fault: string;
}

/** The cases a run with `request.fault` skipped runs, from the record it starts from. */
export async function selectFault(request: FaultRequest): Promise<SuiteSelection> {
  const selection = await import('@variance-authority/sense/test-selection');
  const fault = selection.faultOf(request.fault);
  if (fault === undefined) return declined(`${selection.FAULT_VARIABLE} is empty`);
  const at = request.record ?? await suiteRecord(request.root, request.suite);
  if (!selection.keepsCases(at)) return declined(`no run left a per-case index in ${at}, so every case runs`);
  const coverage = await selection.readTestCoverage(at);
  const whole = coverage.tests.filter((test) => test.complete).map((test) => test.file);
  const index = await readExecutionIndex(at);
  return { ...faultSelection(whole, index, fault), read: selection.recordDigestAt(at) };
}

/** A region of a file as a record holds it, and the test files whose cases entered it. */
export interface EnteredRegion {
  readonly block: ExecutionBlock;
  readonly files: ReadonlySet<string>;
}

/**
 * Region `ordinal` of `file`, read from the first row of the file that holds
 * it as source: a built row numbers another text's regions. Absent when no row
 * does. The driver's candidates and the faulted run's selection both read here.
 */
export function enteredRegion(index: ExecutionIndex, file: string, ordinal: number): EnteredRegion | undefined {
  const block = index.modules
    .filter((module) => module.file === file)
    .map((module) => module.blocks[ordinal])
    .find((found) => found?.source === true);
  if (block === undefined) return undefined;
  return { block, files: new Set(block.crossings.map((crossing) => index.tests[crossing.test]?.file).filter((one) => one !== undefined)) };
}

/** {@link selectFault} over a record already read: `whole` is the test files it holds whole. */
export function faultSelection(whole: readonly string[], index: ExecutionIndex, fault: FaultAddress): SuiteSelection {
  const found = enteredRegion(index, fault.file, fault.ordinal);
  if (found === undefined) return declined(`the record holds no region ${fault.ordinal} of ${fault.file}, so every case runs`);
  const { block, files: entered } = found;
  const region = { kind: 'region' as const, file: fault.file, name: block.name, path: block.path, startLine: block.startLine, endLine: block.endLine };
  const cases = casesToSkip(index, { whole, because: [...entered].map((test) => ({ test, via: [region] })) });
  const lines = block.startLine === block.endLine ? `line ${block.startLine}` : `lines ${block.startLine}-${block.endLine}`;
  return {
    whole: new Set(whole),
    skip: new Set(whole.filter((file) => !entered.has(file))),
    cases,
    notes: [`${entered.size} test file${entered.size === 1 ? '' : 's'} entered ${fault.file}#${fault.ordinal}, ${lines}`],
  };
}

function declined(why: string): SuiteSelection {
  return { whole: new Set(), skip: new Set(), declined: why, notes: [] };
}
