// compass: variance-authority/runtime/attention
import type { Coverage } from './coverage.js';
import { coverageBreakdown } from './coverage-text.js';
import { coverageRows } from './coverage-summary.js';
import { code } from './comment-text.js';

/** A suite that cannot be read remains visible beside the suites that can. */
export type ReviewCoverage = Coverage | { readonly suite?: string; readonly missed: string; readonly unrecorded?: true };

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
    ...readings.flatMap((reading) => 'missed' in reading
      ? ['', `${code(reading.suite ?? 'the record')}: ${code(reading.missed)}`]
      : coverageBreakdown(reading)),
    '', '</details>',
  ];
}
