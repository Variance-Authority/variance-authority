/**
 * A case's readings the record keeps, split by outcome and compared, with no
 * story taped. Cadence charges each region to the test line that first reached
 * it (`case-lines.ts`), so a timing flake is a region charged to another line on
 * every failing run. Async work moves charges from run to run as well, so only
 * what holds on every reading of one outcome and none of the other is told, as
 * `compare.ts` tells it for stories, and the rest is counted.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { caseSectionsAt } from '../test-selection/case-record.js';
import { lineOf } from '../test-selection/case-lines.js';
import { readingsOf, type ReadRegion, type Reading } from '../test-selection/case-readings.js';
import { openSetExecutionIndex } from '../test-selection/execution-set-format.js';
import { steady } from './steady.js';
import { checkoutRecords } from './directory.js';

/** A region a comparison names: its module, its declaration and the path in it, and its lines. */
export interface OutcomeRegion {
  readonly file: string;
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** Where a region was charged on every reading of one outcome: the test line, and whether a hook's statement reached it; no line where none was recorded: the run had no cadence, or a drain ran past its bound and left the case's later regions without one. */
export interface Charge {
  readonly line?: number;
  readonly hook?: true;
}

/** A region every reading of both outcomes crossed, charged one way on every passing reading and another on every failing one. */
export interface Moved {
  readonly region: OutcomeRegion;
  readonly passed: Charge;
  readonly threw: Charge;
}

/** What separates a case's passing readings from its failing ones in the record. */
export interface OutcomeComparison {
  /** The case, by its file and its whole name. */
  readonly file: string;
  readonly name: string;
  /** Runs read on each side; a run that read like another is one of its count. */
  readonly passed: number;
  readonly threw: number;
  /** Crossed on every passing reading and on no failing one, then the other way round. */
  readonly onlyPassed: readonly OutcomeRegion[];
  readonly onlyThrew: readonly OutcomeRegion[];
  /** Charged to another line, or to the ambient bucket on one side alone. */
  readonly moved: readonly Moved[];
  /** Regions that differ between readings of one outcome as well: counted, never listed. */
  readonly unsteady: number;
  /** Whether a side holds one run, so no difference can be told from a run that just went another way. */
  readonly single: boolean;
}

/** The case `name` names, in `file` when given, as one record of this checkout keeps it, with every reading it keeps. */
export interface RecordedCase {
  readonly file: string;
  readonly name: string;
  readonly readings: readonly Reading[];
}

/**
 * Every case a record of this checkout keeps earlier readings of under `name`
 * (its whole name, or `<file> > <name>`), in `file` when given, with its
 * readings. A name two files hold is both, for the caller to refuse.
 */
export function recordedReadings(root: string, name: string, file?: string): RecordedCase[] {
  const found: RecordedCase[] = [];
  for (const record of checkoutRecords(root)) {
    const { index, readings } = caseSectionsAt(record, ['index', 'readings']);
    if (index === undefined || readings === undefined) continue;
    const opened = openSetExecutionIndex(index);
    for (const test of opened?.tests ?? []) {
      if (file !== undefined && test.file !== file) continue;
      if (test.name !== name && test.id !== name) continue;
      const read = readingsOf(readings, index, test.id);
      if (read !== undefined) found.push({ file: test.file, name: test.name, readings: read });
    }
  }
  return found;
}

/**
 * A case's readings split by `stopped` and compared; absent when one outcome
 * holds none. A region is told when every reading of one outcome and none of
 * the other reached it; when both reached it under another line; or when both
 * charged one line but one side a hook's statement, or one side no line, as a
 * page case's drain that came too late is charged (ADR-0089 decision 3).
 */
export function compareOutcomes({ file, name, readings }: RecordedCase): OutcomeComparison | undefined {
  const sides = [readings.filter((reading) => reading.stopped === false), readings.filter((reading) => reading.stopped === true)];
  if (sides.some((side) => side.length === 0)) return undefined;
  const regions = new Map<string, OutcomeRegion>();
  const reads = sides.map((side) => side.map((reading) => readOf(reading, regions)));
  const reached = steady(reads, (read) => read.reached);
  const charged = steady(reads, (read) => read.charged);
  const one = (side: string): OutcomeRegion[] => (reached.held.get(side) ?? []).map((key) => regions.get(key)!).sort(byPlace);
  const passedCharge = new Map((charged.held.get('0') ?? []).map((key) => split(key)));
  const moved = (charged.held.get('1') ?? []).flatMap((key) => {
    const [region, threw] = split(key);
    const passed = passedCharge.get(region);
    return passed === undefined ? [] : [{ region: regions.get(region)!, passed: chargeOf(passed), threw: chargeOf(threw) }];
  }).sort((left, right) => byPlace(left.region, right.region));
  const onlyPassed = one('0');
  const onlyThrew = one('1');
  // A region told is not counted again for what else moved in it.
  const told = new Set([...onlyPassed, ...onlyThrew, ...moved.map(({ region }) => region)]);
  const unsteady = new Set([...reached.unsteady, ...charged.unsteady.map((key) => split(key)[0])].filter((key) => !told.has(regions.get(key)!)));
  const runs = sides.map((side) => side.reduce((sum, reading) => sum + reading.count, 0));
  return {
    file,
    name,
    passed: runs[0]!,
    threw: runs[1]!,
    onlyPassed,
    onlyThrew,
    moved,
    unsteady: unsteady.size,
    single: runs.some((count) => count < 2),
  };
}

interface Read {
  readonly reached: Set<string>;
  readonly charged: Set<string>;
}

function readOf(reading: Reading, regions: Map<string, OutcomeRegion>): Read {
  const read: Read = { reached: new Set(), charged: new Set() };
  for (const region of reading.regions) {
    const key = keyOf(region);
    if (!regions.has(key)) regions.set(key, regionOf(region));
    read.reached.add(key);
    read.charged.add(`${key}\0${region[5] ?? NO_LINE}`);
  }
  return read;
}

function keyOf([file, name, path, startLine]: ReadRegion): string {
  return `${file}\0${name}\0${path}\0${startLine}`;
}

function regionOf([file, name, path, startLine, endLine]: ReadRegion): OutcomeRegion {
  return { file, name, path, startLine, endLine };
}

function split(key: string): [string, number] {
  const at = key.lastIndexOf('\0');
  return [key.slice(0, at), Number(key.slice(at + 1))];
}

/** What a charge is keyed by when the region was crossed with no line recorded: no line value is negative. */
const NO_LINE = -1;

function chargeOf(value: number): Charge {
  if (value === NO_LINE) return {};
  const { line, ambient } = lineOf(value);
  return { line, ...(ambient ? { hook: true as const } : {}) };
}

function byPlace(left: OutcomeRegion, right: OutcomeRegion): number {
  return codeUnitOrder(left.file, right.file) || left.startLine - right.startLine || codeUnitOrder(left.path, right.path);
}
