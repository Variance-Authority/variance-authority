// compass: variance-authority.reach.crossings
import type { SuiteChange } from '@variance-authority/sense/test-selection';
import { code } from './comment-text.js';
import type { Coverage } from './coverage.js';

/** The motion owns the change; subtracting totals would lose its causes. */
export function coverageParts(change: SuiteChange): readonly string[] {
  const said: string[] = [];
  if (change.gained > 0) said.push(`gained ${grouped(change.gained)}`);
  if (change.lost > 0) said.push(`lost ${grouped(change.lost)}`);
  if (change.hidden > 0) said.push(`hidden ${grouped(change.hidden)}`);
  if (change.thinned > 0) said.push(`${grouped(change.thinned)} kept fewer cases`);
  if (change.written.regions > 0) said.push(`written ${grouped(change.written.regions)}, ${grouped(change.written.run)} run`);
  if (change.deleted.regions > 0) said.push(`deleted ${grouped(change.deleted.regions)}, ${grouped(change.deleted.run)} had run`);
  if (change.arrived.files.length > 0) said.push(`now loads ${files(change.arrived.files.length)}, ${grouped(change.arrived.run)} of ${grouped(change.arrived.regions)} run`);
  if (change.departed.files.length > 0) said.push(`no longer loads ${files(change.departed.files.length)}, ${grouped(change.departed.run)} had run`);
  return said.length === 0 ? ['no region gained, lost, written or deleted'] : said;
}

function executionChange(change: SuiteChange): string {
  const said: string[] = [];
  const regions = (count: number) => `${grouped(count)} region${count === 1 ? '' : 's'}`;
  if (change.lost > 0) said.push(`${regions(change.lost)} lost every case`);
  if (change.hidden > 0) said.push(`${regions(change.hidden)} lost every case after a case stopped`);
  if (change.gained > 0) said.push(`${grouped(change.gained)} additional region${change.gained === 1 ? '' : 's'} ran`);
  if (change.thinned > 0) said.push(`${regions(change.thinned)} kept fewer cases`);
  if (change.written.regions > 0 || change.deleted.regions > 0 || change.arrived.files.length > 0 || change.departed.files.length > 0) {
    said.push('Recorded code changed; see coverage details');
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
