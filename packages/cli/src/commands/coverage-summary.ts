// compass: variance-authority.reach.crossings
import type { SuiteChange } from '@variance-authority/sense/test-selection';
import { code } from './comment-text.js';
import type { Coverage } from './coverage.js';

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
  if (change.thinned > 0) said.push(`${grouped(change.thinned)} run by fewer cases`);
  if (change.written.regions > 0) said.push(`+${grouped(change.written.run)} run in ${regions(change.written.regions, 'added region')}`);
  if (change.deleted.regions > 0) said.push(`−${grouped(change.deleted.run)} had run in ${regions(change.deleted.regions, 'removed region')}`);
  if (change.arrived.files.length > 0) said.push(`+${grouped(change.arrived.run)} run in ${grouped(change.arrived.files.length)} newly loaded file${change.arrived.files.length === 1 ? '' : 's'}`);
  if (change.departed.files.length > 0) said.push(`−${grouped(change.departed.run)} had run in ${files(change.departed.files.length)} no longer loaded`);
  return said.length === 0 ? ['no region newly run, no longer run, added or removed'] : said;
}

/** What the signed parts of `change` add to: the change in regions run they account for. */
export function coverageSum(change: SuiteChange): number {
  return change.gained - change.lost - change.hidden + change.written.run - change.deleted.run + change.arrived.run - change.departed.run;
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
  if (change.gained > 0) said.push(`${regions(change.gained)} newly run`);
  if (change.thinned > 0) said.push(`${regions(change.thinned)} run by fewer cases`);
  if (change.written.regions > 0 || change.deleted.regions > 0 || change.arrived.files.length > 0 || change.departed.files.length > 0) {
    said.push('Code changed; see coverage details');
  }
  return said.length === 0 ? 'No change in recorded case execution' : said.join(' · ');
}

/** One row per suite; an absent record or baseline never becomes a zero. */
export function coverageRows(answer: Coverage, percentages: boolean): readonly string[] {
  let counted = 0;
  return answer.suites.map((suite) => {
    const name = code(suite.suite ?? 'the record').replaceAll('|', '\\|');
    if (suite.from === undefined) return percentages ? `| ${name} | Unrecorded | Not compared |` : `| ${name} | Unrecorded |`;
    const now = answer.count.suites[counted]!;
    const was = answer.base?.suites[counted];
    counted += 1;
    const change = suite.base === undefined
      ? 'No baseline available; change cannot be compared'
      : executionChange(suite.base.change);
    const comparison = percentages && was !== undefined
      ? `${ratio(was.run, answer.base!.regions)} previously; ${change}`
      : change;
    return percentages
      ? `| ${name} | ${ratio(now.run, answer.count.regions)} | ${comparison} |`
      : `| ${name} | ${change} |`;
  });
}

export function ratio(run: number, regions: number): string {
  return regions === 0 ? '—' : `${((run / regions) * 100).toFixed(1)}%`;
}

export function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

function files(count: number): string {
  return `${grouped(count)} file${count === 1 ? '' : 's'}`;
}
