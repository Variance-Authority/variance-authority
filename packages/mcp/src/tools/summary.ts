import type { NotObserved, RunReport } from '@variance-authority/report';
import { NO_ARGS, type Tool } from './tool.js';

/**
 * `variance_summary`, and the sections it is assembled from.
 *
 * The helpers below live with it rather than somewhere shared because none of
 * them is a general fact about a report — each is one paragraph of this one
 * answer, and each exists to stop this answer claiming something the run never
 * established. Coverage, order dependence, findings and the closing sentence all
 * repeat the same rule in different words: silence about a subject is not a pass.
 * Read them in the order `run` prints them; that order is the argument.
 */

/**
 * Overview: what happened, what needs attention, and what was never looked at.
 *
 * Deliberately does not list unchanged subjects. A run over 300 subjects where
 * two changed should print two lines — a list as long as the suite is the "100
 * changes? merge" failure in its purest form, and the reader stops reading long
 * before the interesting line.
 *
 * The coverage section is the exception to that economy and is not negotiable.
 * A run that planned 300 subjects, failed on 50 and found the other 250
 * unchanged has an observation list in which every entry is clean; a summary
 * computed from observations alone therefore reports it as a clean run, and an
 * agent acts on that. So `nothing to review` is claimed only from a report that
 * accounted for every subject it planned — never from silence, and never over a
 * subject the run meant to see and could not. That is the same rule the CLI's
 * exit code applies, stated in the same words, because a human and an agent
 * reading one artifact must not be able to disagree about whether it was green.
 */
export const summarize: Tool = {
  name: 'variance_summary',
  description:
    'What the last visual run found: counts by verdict, then one line per subject that ' +
    'needs attention, then which subjects were not observed at all. Unchanged subjects are ' +
    'counted, not listed. Start here.',
  inputSchema: NO_ARGS,

  run(report) {
    const counts = new Map<string, number>();
    for (const observation of report.observations) {
      counts.set(observation.verdict, (counts.get(observation.verdict) ?? 0) + 1);
    }

    const header = [
      `${report.observations.length} subject(s) observed, ${report.retention} run at ${report.at}`,
      `rendered by ${describeIdentity(report)}`,
      // The coverage state joins the verdict counts rather than only appearing in
      // the section below, because that section is as long as the hole is and the
      // hole is what a reader most needs in the first four lines. A run that lost
      // 50 subjects otherwise opens with "250 unchanged" and says so 50 lines later.
      [...counts.entries()]
        .map(([verdict, count]) => `${count} ${verdict}`)
        .concat(shortfall(report))
        .join(', '),
      ...(report.intent !== undefined ? [`intent: ${report.intent}`] : []),
    ];

    const notable = report.observations.filter((o) => o.verdict !== 'unchanged');

    return [
      ...header,
      ...(notable.length === 0
        ? []
        : [
            '',
            ...notable.map((observation) => {
              const cause = observation.regions.find((region) => region.cause);
              const lead = cause?.component !== undefined ? ` — ${cause.component}` : '';
              // Labelled by what it *is* rather than by its verdict. The verdict
              // stays `changed` — the pixels really did move — but a reader who
              // acts on that word reviews a component that nothing edited. The
              // two need opposite actions, so they get different words.
              const label =
                observation.alone?.reproduced === false ? 'order-dependent' : observation.verdict;
              const because =
                observation.alone?.reproduced === false
                  ? observation.alone.because
                  : observation.because;
              return `[${label}] ${observation.subject}${lead}: ${because}`;
            }),
          ]),
      '',
      ...coverage(report),
      ...orderDependence(report),
      ...findingsLine(report),
      ...(notable.length === 0 ? ['', settlement(report)] : []),
    ].join('\n');
  },
};

/**
 * Subjects whose change vanished when nothing else had run.
 *
 * Separated from the verdict counts because it is a different kind of work.
 * Every other line in this summary is about a component; these are about the
 * *suite* — some earlier subject left shared state behind, and this one read it.
 * Filed under `changed` they read as a backlog of reviews, and a reviewer who
 * opens one finds a component nobody touched.
 *
 * What this section deliberately does not print is who poisoned them. The run
 * has no evidence for that: a leak that lives in module scope — a singleton
 * store, a cached client, a memoized selector — is invisible to anything a
 * document can observe about itself. The honest handoff is the difference,
 * already resolved to a region and a component and a file, plus the fact that a
 * clean world does not show it. Narrowing to the writer from there is a
 * bisection over run order, which is work for whoever reads this, and cheap
 * once they know it is the answer they are looking for.
 */
function orderDependence(report: RunReport): readonly string[] {
  const leaked = report.observations.filter((o) => o.alone?.reproduced === false);
  if (leaked.length === 0) return [];

  return [
    '',
    `order dependence: ${leaked.length} subject(s) changed under the shared session and`,
    '  matched the baseline when re-collected alone. These are not component changes and',
    '  `accept` refuses them. The writer is not named — module-level state is outside',
    '  anything a render can see — so bisect run order over:',
    ...leaked.map((observation) => `    ${observation.subject}`),
  ];
}

/**
 * The coverage section, in three states — and the third is why this is not
 * simply a list.
 *
 * `absent` means the report's writer never said what it skipped. That is not the
 * same sentence as "it skipped nothing" and must not be printed as one: a reader
 * shown a clean summary over a report that never counted its subjects has been
 * told the suite is green by something that never looked at the suite. Costs
 * three lines of output on every report a `variance run` did not write, which is
 * the price of not collapsing "unknown" into "fine".
 */
function coverage(report: RunReport): readonly string[] {
  const entries = report.notObserved;

  if (entries === undefined) {
    return [
      'coverage: unknown — this report does not state which subjects were not observed.',
      '  It was not written by `variance run`, so silence about a subject here cannot be',
      '  read as a pass.',
    ];
  }

  if (entries.length === 0) return ['coverage: every planned subject was observed.'];

  const failed = entries.filter((entry) => entry.kind === 'failed');
  const excluded = entries.filter((entry) => entry.kind === 'excluded');

  // Every entry is named, however many there are. A count alone leaves an agent
  // unable to act, and a capped list reads as complete coverage — the failure
  // `truncated` exists to prevent, applied to the list that matters most.
  return [
    `not observed: ${entries.length} subject(s) — ` +
      `${failed.length} the run could not see, ${excluded.length} excluded by configuration`,
    ...failed.map(coverageLine),
    ...excluded.map(coverageLine),
  ];
}

function coverageLine(entry: NotObserved): string {
  return `  [${entry.kind}] ${entry.subject}: ${entry.because}`;
}

/** The coverage state as one clause, for the counts line. Empty when there is none to state. */
function shortfall(report: RunReport): readonly string[] {
  if (report.notObserved === undefined) return ['coverage unknown'];
  return report.notObserved.length === 0
    ? []
    : [`${report.notObserved.length} not observed`];
}

/**
 * One line, and only when there is something to say.
 *
 * Findings do not change the verdict, so they must not be able to make a clean
 * run read as dirty — but a run that found fourteen controls with no accessible
 * name and mentioned none of them has withheld the only thing it knew that a
 * comparison could not have told it.
 */
function findingsLine(report: RunReport): readonly string[] {
  const inspected = report.observations.filter((o) => o.findings !== undefined);
  const subjects = inspected.filter((o) => o.findings!.length > 0);
  const total = subjects.reduce((sum, o) => sum + o.findings!.length, 0);

  if (total > 0) {
    return [
      `findings: ${total} in ${subjects.length} subject(s), found without a baseline — ` +
        'call variance_findings. These do not affect the verdict.',
    ];
  }

  // "Inspected and clean" is worth one line; "nobody inspected anything" is
  // worth nothing here and is said by `variance_findings` when asked, because a
  // reader who did not ask must not be told either way.
  return inspected.length === 0
    ? []
    : [`findings: none in ${inspected.length} inspected subject(s).`];
}

/**
 * The closing sentence when no observation is notable — the one an agent stops
 * reading at, and therefore the one that must not overstate.
 *
 * Only the third branch may say "nothing to review". The first two are the cases
 * where the observations are all clean and the run still is not: an unaccounted
 * report, and a hole the run meant to fill. Both mirror `exitFor`'s `1`.
 */
function settlement(report: RunReport): string {
  const entries = report.notObserved;

  if (entries === undefined) {
    return (
      'no observed subject needs review, but this report never stated what it skipped — ' +
      'it cannot be read as a clean run'
    );
  }

  const failed = entries.filter((entry) => entry.kind === 'failed').length;
  if (failed > 0) {
    return (
      `no observed subject needs review, but ${failed} subject(s) the run meant to see were ` +
      'not observed — an absent observation is not an unchanged one'
    );
  }

  return 'nothing to review';
}

function describeIdentity(report: RunReport): string {
  const { renderer, engine, platform, deviceScaleFactor } = report.identity;
  return `${renderer} (${engine}, ${platform}, ${deviceScaleFactor}x)`;
}
