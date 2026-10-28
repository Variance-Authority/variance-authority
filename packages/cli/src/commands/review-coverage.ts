// compass: variance-authority/runtime/attention
import type { Coverage } from './coverage.js';
import { EARNED_HEADER, EARNED_NOTE, earnedRows } from './coverage-owner-text.js';
import { coverageBreakdown } from './coverage-text.js';
import { coverageRows } from './coverage-summary.js';
import { code } from './comment-text.js';
import type { MissedSuite } from './review-suites.js';

export type ReviewCoverage = Coverage | MissedSuite;

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
