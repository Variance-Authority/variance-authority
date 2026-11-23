// compass: variance-authority.reach.crossings
import type { RunOver, SuiteChange, SuiteCount } from '@variance-authority/sense/test-selection';
import { code } from './comment-text.js';
import type { CoverageSource } from './coverage-source.js';
import type { Coverage, CoverageSuite } from './coverage.js';

/**
 * The parts of a suite's change in regions run, each signed by what it does to
 * the count, so they add up to the count's own change. Fewer cases is said
 * unsigned: those regions still run.
 */
export function coverageParts(change: SuiteChange): readonly string[] {
  const said: string[] = [];
  const regions = (count: number, word: string) => `${grouped(count)} ${word}${count === 1 ? '' : 's'}`;
  if (change.gained > 0) said.push(`+${grouped(change.gained)} newly run`);
  if (change.lost > 0) said.push(`−${grouped(change.lost)} no longer run`);
  if (change.hidden > 0) said.push(`−${grouped(change.hidden)} no longer run after a case stopped`);
  if (change.unmeasured > 0) said.push(`−${grouped(change.unmeasured)} unmeasured: their cases last ran before their file changed`);
  if (change.thinned > 0) said.push(`${grouped(change.thinned)} run by fewer cases`);
  if (change.written.regions > 0) said.push(`+${grouped(change.written.run)} run in ${regions(change.written.regions, 'added region')}`);
  if (change.deleted.regions > 0) said.push(`−${grouped(change.deleted.run)} had run in ${regions(change.deleted.regions, 'removed region')}`);
  if (change.arrived.files.length > 0) said.push(`+${grouped(change.arrived.run)} run in ${grouped(change.arrived.files.length)} newly loaded file${change.arrived.files.length === 1 ? '' : 's'}`);
  if (change.departed.files.length > 0) said.push(`−${grouped(change.departed.run)} had run in ${files(change.departed.files.length)} no longer loaded`);
  return said.length === 0 ? ['no region newly run, no longer run, added or removed'] : said;
}

/** What the signed parts of `change` add to: the change in regions run they account for. */
export function coverageSum(change: SuiteChange): number {
  return change.gained - change.lost - change.hidden - change.unmeasured + change.written.run - change.deleted.run + change.arrived.run - change.departed.run;
}

/** `+2`, `−3`, `0`. */
export function signed(value: number): string {
  return value > 0 ? `+${grouped(value)}` : value < 0 ? `−${grouped(-value)}` : '0';
}

function executionChange(change: SuiteChange): string {
  const said: string[] = [];
  const regions = (count: number) => `${grouped(count)} region${count === 1 ? '' : 's'}`;
  if (change.lost > 0) said.push(`${regions(change.lost)} no longer run`);
  if (change.hidden > 0) said.push(`${regions(change.hidden)} no longer run after a case stopped`);
  if (change.unmeasured > 0) said.push(`${regions(change.unmeasured)} unmeasured since their file changed`);
  if (change.gained > 0) said.push(`${regions(change.gained)} newly run`);
  if (change.thinned > 0) said.push(`${regions(change.thinned)} run by fewer cases`);
  if (change.written.regions > 0 || change.deleted.regions > 0 || change.arrived.files.length > 0 || change.departed.files.length > 0) {
    said.push('Code changed; see coverage details');
  }
  return said.length === 0 ? 'No change in recorded case execution' : said.join(' · ');
}

/** A suite the answer names, with its count and its base's when it has a record; an unrecorded suite has neither. */
export interface PairedSuite {
  readonly suite: CoverageSuite;
  readonly now?: SuiteCount;
  readonly was?: SuiteCount;
}

/** Each suite in declaration order with its counts, which hold only the recorded suites, in the same order. */
export function paired(answer: Coverage): readonly PairedSuite[] {
  let counted = 0;
  return answer.suites.map((suite) => {
    if (suite.from === undefined) return { suite };
    const at = counted;
    counted += 1;
    const was = answer.base?.suites[at];
    return { suite, now: answer.count.suites[at]!, ...(was === undefined ? {} : { was }) };
  });
}

/** The summary table's head: its figure is what ran over this text where the count parts what ran by text. */
export function coverageHead(answer: Coverage): readonly string[] {
  return [`| Suite | ${answer.count.over === undefined ? 'Regions executed by cases' : 'Regions run over this text'} | Compared with baseline |`, '|---|--:|---|'];
}

/** One row per suite; an absent record or baseline never becomes a zero. */
export function coverageRows(answer: Coverage, percentages: boolean): readonly string[] {
  return paired(answer).map(({ suite, now, was }) => {
    const name = code(suite.suite ?? 'the record').replaceAll('|', '\\|');
    if (now === undefined) return percentages ? `| ${name} | Unrecorded | Not compared |` : `| ${name} | Unrecorded |`;
    const change = suite.base === undefined
      ? 'No baseline available; change cannot be compared'
      : executionChange(suite.base.change);
    // Parted, the figure is what ran over this text, and the comparison is of what ran over any.
    const ran = now.over === undefined ? '' : `${ratio(now.run, answer.count.regions)} ran in any text${was === undefined ? '' : ', '}`;
    const comparison = percentages && was !== undefined
      ? `${ran}${ratio(was.run, answer.base!.regions)} previously; ${change}`
      : percentages && ran !== '' ? `${ran}; ${change}` : change;
    return percentages
      ? `| ${name} | ${ratio(leading(now), answer.count.regions)} | ${comparison} |`
      : `| ${name} | ${change} |`;
  });
}

/** What `--at-distance` narrowed the counts to, as a clause after the heading, and the test files it could not place. */
export function banded(answer: Coverage): string {
  const { atDistance } = answer;
  if (atDistance === undefined) return '';
  const { from, to, unplaced, unmeasured } = atDistance;
  const hops = to === undefined ? `${from} or more` : from === to ? `${from}` : `${from}-${to}`;
  const left = unplaced.length === 0 ? '' : `; ${grouped(unplaced.length)} test file${unplaced.length === 1 ? '' : 's'} not on the import graph left out`;
  const outside = unmeasured === 0 ? '' : `; ${grouped(unmeasured)} region${unmeasured === 1 ? '' : 's'} run from no measured distance, in no band`;
  return `, counted where the nearest test that ran the code is ${hops} import hop${hops === '1' ? '' : 's'} away${left}${outside}`;
}

/** The regions a count leads with: what ran over this text where the count parts it by text, else what ran. */
export function leading(count: { readonly run: number; readonly over?: RunOver }): number {
  return count.over?.this ?? count.run;
}

export function ratio(run: number, regions: number): string {
  return regions === 0 ? '—' : `${((run / regions) * 100).toFixed(1)}%`;
}

export function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

/** `1 file`, `1,234 files`. */
export function files(count: number): string {
  return `${grouped(count)} file${count === 1 ? '' : 's'}`;
}

/** Which files the source counts, as `--from` chose them. */
export function sourceWhere(source: CoverageSource): string {
  if (source.seeds === 'entrypoints') {
    return source.from === undefined ? 'reached from the declared entry points' : `reached from the entry points of ${source.from}`;
  }
  return source.seeds === 'directory' ? `reached from every file under ${source.from}, which declares no entry points` : 'in the source index';
}

/** `2 files did not parse, …`: why the regions of unloaded files are short of what they hold. */
export function unparsed(count: number): string {
  return `${files(count)} did not parse, so no regions are counted for them`;
}

/** A commit as the answers name it: its first eight characters. */
export function short(commit: string): string {
  return commit.slice(0, 8);
}

/** Columns padded to the widest cell, with no trailing space. */
export function table(rows: readonly (readonly string[])[]): readonly string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, at) => (widths[at] = Math.max(widths[at] ?? 0, cell.length)));
  return rows.map((row) => row.map((cell, at) => cell.padEnd(widths[at]!)).join('  ').trimEnd());
}
