// compass: variance-authority/runtime/attention
import type { Coverage } from './coverage.js';
import { EARNED_HEADER, EARNED_NOTE, earnedRows } from './coverage-owner-text.js';
import { coverageBreakdown } from './coverage-text.js';
import { coverageRows } from './coverage-summary.js';
import { code } from './comment-text.js';
import type { MissedSuite } from './review-suites.js';

export type ReviewCoverage = Coverage | MissedSuite;

/**
 * Regions a suite's base ran and no case runs now, read as an exit. It is a
 * count of `lost`: a region deleted with its code is not lost, and one carried
 * over an edit is `unmeasured`, which says neither way. A base that could not be
 * read is said and never fails: nothing was compared.
 */
export function lostVerdict(readings: readonly ReviewCoverage[]): { readonly failed: boolean; readonly said: readonly string[] } {
  const suites = readings.flatMap((reading) => ('missed' in reading ? [] : reading.suites));
  const lost = suites.flatMap((suite) => (suite.base !== undefined && suite.base.change.lost > 0 ? [{ name: suite.suite ?? 'the record', count: suite.base.change.lost }] : []));
  const total = lost.reduce((sum, { count }) => sum + count, 0);
  const missed = [
    ...readings.flatMap((reading) => ('missed' in reading ? [{ suite: reading.suite, why: reading.missed }] : [])),
    ...suites.flatMap((suite) => (suite.base !== undefined ? [] : [{ suite: suite.suite, why: suite.baseMissed ?? 'it has no base' }])),
  ];
  return {
    failed: total > 0,
    said: [
      ...(total === 0 ? [] : [`${total} ${total === 1 ? 'region' : 'regions'} the mainline ran no case runs now: ${lost.map(({ name, count }) => `${count} in ${name}`).join(', ')}.`]),
      ...missed.map(({ suite, why }) => `${suite ?? 'the record'} was not compared, so what it stopped running is not known: ${why}`),
    ],
  };
}

export function reviewCoverageSummary(readings: readonly ReviewCoverage[]): readonly string[] {
  return ['', '| Suite | Change in execution |', '|---|---|', ...readings.flatMap((reading) =>
    'missed' in reading ? [`| ${code(reading.suite ?? 'the record').replaceAll('|', '\\|')} | ${reading.unrecorded === true ? 'Unrecorded' : 'Coverage unavailable'} |`] : coverageRows(reading, false),
  )];
}

export function reviewCoverageDetails(readings: readonly ReviewCoverage[]): readonly string[] {
  return [
    '', '<details><summary>Coverage by suite</summary>', '',
    '| Suite | Regions executed by cases | Compared with baseline |', '|---|--:|---|',
    ...readings.flatMap((reading) => 'missed' in reading
      ? [`| ${code(reading.suite ?? 'the record').replaceAll('|', '\\|')} | ${reading.unrecorded === true ? 'Unrecorded' : 'Unavailable'} | Not compared |`]
      : coverageRows(reading, true)),
    '', 'Each percentage uses the regions loaded in that suite’s report. The reports have separate denominators; their percentages cannot be added. Module-load execution is counted separately.',
    ...earned(readings),
    ...readings.flatMap((reading) => 'missed' in reading
      ? ['', `${code(reading.suite ?? 'the record')}: ${code(reading.missed)}`]
      : coverageBreakdown(reading)),
    '', '</details>',
  ];
}

/** Each suite in and out, one table over every reading that counted it. */
function earned(readings: readonly ReviewCoverage[]): readonly string[] {
  const rows = readings.flatMap((reading) => 'missed' in reading ? [] : earnedRows(reading.earned));
  return rows.length === 0 ? [] : ['', ...EARNED_HEADER, ...rows, '', EARNED_NOTE];
}
