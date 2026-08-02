import { toolByName } from '@variance-authority/mcp';
import { OperatorError } from '../exit.js';
import type { CliRunReport, NotObserved } from './run.js';

/**
 * `variance report` — ask questions of an artifact, never of a browser.
 *
 * **This command never re-runs, and that is its whole point.** The alternative
 * design — a report command that observes afresh — has one obvious advantage (the
 * answer is current) and one fatal property: the answer then depends on the
 * machine asking. Rasterization is machine-bound, so "why did `Button` change"
 * asked from a laptop about a run that happened on a pinned CI container is a
 * different question with a different answer, and nothing in the output would say
 * so. Making the file the contract means a run can happen where it must and the
 * questions can be asked anywhere, by anyone, for as long as the file exists.
 *
 * The cost is real and is accepted: a report can be stale, and this command
 * cannot tell. What it can do is refuse to pretend otherwise — every answer here
 * is prefaced by the run's own timestamp and renderer, which are in the artifact.
 *
 * ## Text answers are the MCP tools' answers
 *
 * `formatReport` calls the same functions `@variance-authority/mcp` exposes to an
 * agent rather than formatting the report a second way. Two formatters over one
 * artifact drift, and the day they do, a human and an agent looking at the same
 * run disagree about what it found — with no way to tell which of them is reading
 * the tool that was fixed.
 *
 * What is added on top is the one thing those tools cannot know about, because
 * their type does not carry it: the subjects that were not observed at all.
 */

export type ReportFormat = 'text' | 'json';

export interface ReportOptions {
  readonly report: CliRunReport;
  readonly format: ReportFormat;
  /** One subject, by id. Omissions are counted in the output, never silent. */
  readonly subject?: string;
}

/**
 * The report as text or as JSON, with nothing dropped in either.
 *
 * The JSON form is a `RunReport` and round-trips: reading the output back through
 * `readCliRunReport` yields the same value, which is what makes this command
 * usable as a filter in a pipeline rather than only by a person.
 */
export function formatReport(options: ReportOptions): string {
  return options.format === 'json' ? asJson(options) : asText(options);
}

function asJson(options: ReportOptions): string {
  const { report, subject } = options;
  if (subject === undefined) return `${JSON.stringify(report, null, 2)}\n`;

  const observations = report.observations.filter((entry) => entry.subject === subject);
  const notObserved = (report.notObserved ?? []).filter((entry) => entry.subject === subject);

  if (observations.length === 0 && notObserved.length === 0) throw unknownSubject(report, subject);

  const narrowed = {
    ...report,
    observations,
    ...(report.notObserved !== undefined ? { notObserved } : {}),
    /**
     * What the filter removed, counted.
     *
     * Present only when narrowing, so an unfiltered report round-trips byte for
     * byte. A filtered document is still a valid run report — which is what makes
     * it pipeable — and would otherwise be indistinguishable from a run that
     * observed one subject.
     */
    selection: {
      subject,
      omittedObservations: report.observations.length - observations.length,
      omittedNotObserved: (report.notObserved ?? []).length - notObserved.length,
    },
  };

  return `${JSON.stringify(narrowed, null, 2)}\n`;
}

function asText(options: ReportOptions): string {
  const { report, subject } = options;

  if (subject !== undefined) {
    const skipped = (report.notObserved ?? []).find((entry) => entry.subject === subject);
    if (skipped !== undefined) {
      // Answered from the coverage list rather than refused. "Unknown subject" for
      // something the run deliberately did not look at sends the reader hunting
      // for a typo instead of reading the reason, which is right here.
      return [
        `[not observed] ${skipped.subject}`,
        skipped.because,
        skipped.kind === 'excluded'
          ? 'This was excluded by configuration, not by a failure.'
          : 'The run meant to observe this and could not. It is not a pass.',
      ].join('\n');
    }

    if (!report.observations.some((entry) => entry.subject === subject)) {
      throw unknownSubject(report, subject);
    }
    return tool('variance_describe', report, { subject });
  }

  return [tool('variance_summary', report, {}), coverage(report)].join('\n\n');
}

/**
 * The coverage section — the part of the output with no counterpart in a
 * pixel-diff tool.
 *
 * Three states, and the third is the reason this is not simply a list. `absent`
 * means the report's writer never said what it skipped, which is not the same
 * sentence as "it skipped nothing" and must not be printed as one: a reader who
 * sees a clean summary over a report that does not account for its subjects has
 * been told the suite is green by something that never counted the suite.
 */
function coverage(report: CliRunReport): string {
  const entries = report.notObserved;

  const warnings =
    report.warnings === undefined || report.warnings.length === 0
      ? []
      : ['', 'warnings:', ...report.warnings.map((warning) => `  ${warning}`)];

  if (entries === undefined) {
    return [
      'coverage: unknown — this report does not state which subjects were not observed.',
      '  It was not written by `variance run`, so silence about a subject here cannot be',
      '  read as a pass.',
      ...warnings,
    ].join('\n');
  }

  if (entries.length === 0) {
    return ['coverage: every planned subject was observed.', ...warnings].join('\n');
  }

  const failed = entries.filter((entry) => entry.kind === 'failed');
  const excluded = entries.filter((entry) => entry.kind === 'excluded');

  return [
    `not observed: ${entries.length} subject(s) — ` +
      `${failed.length} the run could not see, ${excluded.length} excluded by configuration`,
    ...failed.map(line),
    ...excluded.map(line),
    ...warnings,
  ].join('\n');
}

function line(entry: NotObserved): string {
  return `  [${entry.kind}] ${entry.subject}: ${entry.because}`;
}

function tool(
  name: string,
  report: CliRunReport,
  input: Readonly<Record<string, unknown>>,
): string {
  const found = toolByName(name);
  if (found === undefined) {
    // Unreachable while the two packages are in one repository, and a thrown
    // error rather than a silent fallback so that it stays unreachable: a second
    // formatter grown here is exactly what this file exists not to have.
    throw new Error(`@variance-authority/mcp no longer exposes \`${name}\``);
  }
  return found.run(report, input);
}

function unknownSubject(report: CliRunReport, subject: string): OperatorError {
  const known = [
    ...report.observations.map((entry) => entry.subject),
    ...(report.notObserved ?? []).map((entry) => entry.subject),
  ];

  return new OperatorError(
    `this run has no subject \`${subject}\`; it has: ${known.join(', ')}`,
  );
}
