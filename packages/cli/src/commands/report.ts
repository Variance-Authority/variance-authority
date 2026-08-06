import { toolByName } from '@variance-authority/mcp/tools';
import { OperatorError } from '../exit.js';
import type { CliRunReport } from './run.js';
import { reportHtml } from './report-html.js';
import { summarizeLedger } from './ignores.js';
import { summarizeSensitivities } from './sensitivities.js';

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
 * their type does not carry it: the index warnings that belong to no subject.
 */

export type ReportFormat = 'text' | 'json' | 'html';

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
  if (options.format === 'json') return asJson(options);
  if (options.format === 'html') return asHtml(options);
  return asText(options);
}

/**
 * The page, and the one narrowing it refuses.
 *
 * `--subject` narrows the text and the JSON because both are answers to a
 * question about one subject. A *page* narrowed to one subject would be a page
 * that says nothing about coverage while looking complete, and the reader of an
 * HTML artifact has no prompt to type the unnarrowed command in. So it is
 * refused by name rather than honoured or ignored.
 */
function asHtml(options: ReportOptions): string {
  if (options.subject !== undefined) {
    throw new OperatorError(
      '--subject narrows a report to one subject, and an HTML page narrowed that way ' +
        'would look like a complete run that found one thing. Use --format text or json ' +
        'for a single subject.',
    );
  }
  return `${reportHtml(options.report)}\n`;
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

  return [tool('variance_summary', report, {}), ignores(report), sensitivities(report), warnings(report)]
    .filter((section) => section !== '')
    .join('\n\n');
}

/**
 * The only section this command adds, and the reason it is only this.
 *
 * Coverage — *which subjects were not observed, and why* — was printed here as
 * well as by `variance_summary`, so every run said "coverage: every planned
 * subject was observed." twice. The tests could not see it: they all assert with
 * `toContain`, which is satisfied by the first copy.
 *
 * Found by the first real `variance run`, and it is the exact failure the
 * doc-comment above warns about, arrived at from the other direction. Two
 * formatters over one artifact drift; `tool()` exists so that cannot happen, and
 * a second implementation grew beside it anyway because the CLI's report type is
 * a superset and `notObserved` looked like the CLI's business. It is not:
 * `variance_summary` reads that field too.
 *
 * `warnings` genuinely is. It is on `CliRunReport` and not on `RunReport`, so no
 * MCP tool can see it, and an index complaint that belongs to no single subject
 * would otherwise be written to the file and never read aloud.
 *
 * `ignores` is the second, on the same terms. A ledger of what each ignore rule
 * absorbed is a fact about the *configuration*, and the MCP tools read reports
 * that no config produced. What the tools can see is the consequence — an
 * `ignored` verdict, which is not `unchanged` — so nothing here is the only
 * evidence of anything.
 */
function ignores(report: CliRunReport): string {
  return summarizeLedger(report.ignores).join('\n');
}

/**
 * The sensitivity ledger, on the same terms as the ignore one.
 *
 * A separate paragraph rather than a section of `ignores`, because a reader
 * auditing a green run needs to know *which kind* of declaration produced it. A
 * masked clock and a route asserted only on layout are both green and are not
 * the same promise, and one paragraph covering both would let a reader who
 * skimmed it believe they had checked the other.
 */
function sensitivities(report: CliRunReport): string {
  return summarizeSensitivities(report.sensitivities).join('\n');
}

function warnings(report: CliRunReport): string {
  if (report.warnings === undefined || report.warnings.length === 0) return '';
  return ['warnings:', ...report.warnings.map((warning) => `  ${warning}`)].join('\n');
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
