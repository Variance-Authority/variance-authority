import { datingOf } from '@variance-authority/report';
import type { NotObserved, RunReport } from '@variance-authority/report';
import { presentationSummary } from '../presentation.js';
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

    // `ignored` is counted in the header and does not get a line of its own.
    // It is a real state and it is not a finding: a shared header carrying a
    // clock puts every subject in the suite here, and three hundred lines saying
    // "you already decided not to look at this" is the output nobody reads —
    // which is how the *other* lines get missed. The header count keeps it
    // visible, and `variance run` prints the per-rule ledger beneath it.
    //
    // `unstable` goes the other way and joins this list even when the verdict is
    // green, and the reason is the last line of this answer: a run whose only
    // finding was an unstable subject printed "nothing to review" directly under
    // a heading naming six of them. Under `--flakes` that is the *normal* case —
    // every subject agrees with its baseline, and the whole point of the mode is
    // what agreeing with a baseline does not say — so it was not an edge.
    const notable = report.observations.filter(
      (o) =>
        (o.verdict !== 'unchanged' && o.verdict !== 'ignored') ||
        (o.unstable !== undefined && o.unstable.absorbed === undefined),
    );

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
              // An absorbed instability is not one of these. The subject declared
              // that it does not assert on what moved, so it is neither a defect
              // nor a different word for its verdict — it is listed further down,
              // under a heading that says so.
              const reported =
                observation.unstable !== undefined && observation.unstable.absorbed === undefined
                  ? observation.unstable
                  : undefined;
              const label = reported
                ? 'unstable'
                : observation.alone?.reproduced === false
                  ? 'order-dependent'
                  : observation.verdict;
              const because = reported
                ? reported.because
                : observation.alone?.reproduced === false
                  ? observation.alone.because
                  : observation.because;
              return `[${label}] ${observation.subject}${lead}: ${because}`;
            }),
          ]),
      '',
      ...coverage(report),
      ...drift(report),
      ...instability(report),
      ...orderDependence(report),
      ...findingsLine(report),
      ...presentationSummary(report),
      ...(notable.length === 0 ? ['', settlement(report)] : []),
    ].join('\n');
  },
};

/**
 * Subjects that did not agree with themselves, and the one section here written
 * to be *acted on* rather than reviewed.
 *
 * Above every other finding, because it invalidates them. A subject that reads
 * differently twice in a row has a verdict that was decided by which of the two
 * readings the run happened to take first, and an agent that starts reviewing
 * its regions is reading a diff against a coin flip. Nothing else in this
 * summary is worth doing on these subjects until this is.
 *
 * The component and the band are printed because they are what makes the fix
 * bounded. "This subject is flaky" is a page to read; `Clock (content)` is a node
 * whose text moves between two readings taken seconds apart, and the causes of
 * that are a short list — a clock, a random seed, an id counter, a request that
 * had not landed. The band narrows it further: `content` is data, `geometry` is
 * layout that has not settled, `token` is a style that is still being applied.
 *
 * This is where the base layer hands over. Animations are pinned, GIFs are frozen
 * on the wire, fonts and images are waited for, and every asset's bytes are in
 * the environment key — so a subject that still disagrees with itself is past
 * everything a recipe can do, and is a defect in the page with a name attached
 * rather than a tolerance to widen.
 */
function instability(report: RunReport): readonly string[] {
  const unstable = report.observations.filter(
    (o) => o.unstable !== undefined && o.unstable.absorbed === undefined,
  );
  if (unstable.length === 0) return absorbedInstability(report);

  const bands = new Set(unstable.flatMap((o) => o.unstable?.bands ?? []));

  return [
    '',
    `UNSTABLE: ${unstable.length} subject(s) were read twice, seconds apart, with nothing`,
    '  changed in between, and the two readings disagreed. Their verdicts were decided by',
    '  whichever reading came first, so do not review their regions and do not accept them',
    '  (`accept` refuses these). Fix what moves between two readings of the same page:',
    ...unstable.flatMap((observation) => {
      const moved = observation.unstable;
      const named = (moved?.components ?? [])
        .map((component) =>
          component.file === undefined ? component.name : `${component.name} ${component.file}`,
        )
        .join(', ');
      const where = named === '' ? '' : ` — ${named}`;
      const inBands = moved === undefined || moved.bands.length === 0 ? '' : ` (${moved.bands.join(', ')})`;
      return [`    ${observation.subject}${where}${inBands}`, ...recurrence(report, observation.subject)];
    }),
    ...remedies(bands),
    // The loop closes here. Everything above tells a reader what moved and how
    // often; this is the one line that says how to find out whether the edit
    // they are about to make worked — without re-running three hundred subjects
    // and without waiting for tomorrow's build to be the experiment.
    '  Check a fix by reading the same subject twice again, and nothing else:',
    ...unstable.map((observation) => `    variance run --subjects '${observation.subject}' --flakes`),
    '  It exits 1 while the two readings still disagree, even with every verdict green.',
    ...absorbedInstability(report),
  ];
}

/**
 * Tokens whose value moved in this run, and how far they have travelled.
 *
 * The one finding on this page that no comparison could have produced. Every
 * other line answers *what moved*; this answers *how much it has moved
 * altogether*, which is a sum across approvals and is therefore invisible to
 * every review that approved one of them. Eleven correct approvals of 2px each
 * are eleven correct decisions and one 22px change nobody made.
 *
 * Placed above the instability section deliberately: it is rarer, it is never
 * noise, and it is the finding a reader would most regret scrolling past.
 */
function drift(report: RunReport): readonly string[] {
  const moved = Object.entries(report.drift ?? {});
  if (moved.length === 0) return [];

  return [
    '',
    `DRIFT: ${moved.length} token(s) moved in this run, and the record says what they have`,
    '  drifted to across every approved change in the window. No single review saw these',
    '  totals, because each of them approved one step:',
    ...moved.map(([, record]) => `    ${record.because}`),
  ];
}

/**
 * What the record says about a subject that just read differently.
 *
 * Two readings are a **lower bound** and can never be more: a subject that flakes
 * one time in fifty passes that check forty-nine runs out of fifty. This is the
 * only line in the answer that can distinguish *a fixture that has been bad for a
 * month* from *something that started today*, and those need different people.
 *
 * The absent case gets a line too, and it is the one worth being careful about.
 * Silence here would read as "first time", which is a claim — and it is the claim
 * a reader most wants to be true.
 */
function recurrence(report: RunReport, subject: string): readonly string[] {
  const record = report.flakiness?.[subject];

  if (record === undefined) {
    return [
      '      no history record answered for this subject, so nothing here says whether it has',
      '      happened before. That is silence, not a first occurrence.',
    ];
  }

  const shape =
    record.sweepsSince > 0 && record.occurrences > 1
      ? '      — it has been quiet since, so check whether a fix already landed before writing one'
      : record.occurrences > 1
        ? '      — recurring, and the most recent sweep still saw it: the fixture is the bug'
        : '      — the record has not seen this before';

  return [`      ${record.because}`, shape];
}

/**
 * Subjects that moved between two readings, in bands they do not claim to assert
 * on.
 *
 * Counted and named, never silent — the same rule `ignored` follows for pixels,
 * one level up and about kinds. A route declared `layout` with a live clock in it
 * is *working as declared*, and reporting it as a defect would make every
 * route-level test red for exactly the reason its level was written. But a
 * declaration that is quietly absorbing movement is also how a suite ends up
 * green over a surface nobody watches, so it gets a line and names the rule that
 * did it — which is what makes it auditable later.
 */
function absorbedInstability(report: RunReport): readonly string[] {
  const absorbed = report.observations.filter((o) => o.unstable?.absorbed !== undefined);
  if (absorbed.length === 0) return [];

  return [
    '',
    `not asserted on: ${absorbed.length} subject(s) read differently between two readings,`,
    '  entirely in bands their declared level does not assert on. Working as declared, and',
    '  listed because a declaration nobody re-reads is how a suite stops watching something:',
    ...absorbed.map((observation) => {
      const bands = observation.unstable?.bands ?? [];
      const rule = observation.unstable?.absorbed?.rule ?? 'a sensitivity rule';
      const level = observation.unstable?.absorbed?.level ?? 'its level';
      return `    ${observation.subject} — ${bands.join(', ')}, absorbed by \`${rule}\` (asserts on ${level})`;
    }),
  ];
}

/**
 * What the band means for the fix, which is the whole reason a band is reported.
 *
 * A frequency band is not a severity — it is a statement about *what kind of
 * thing* moved, and each kind has a short list of causes. An agent handed "this
 * subject is flaky" has a page to read; one handed `content` has four candidates
 * and can check all of them in a minute.
 *
 * Masking is listed last and hedged, deliberately. A clock genuinely is a clock
 * and an ignore is the right answer for it — but reaching for one first is how a
 * suite ends up green over a surface nobody watches, and the same mask that hides
 * this hides the regression that later lands in the same place.
 */
function remedies(bands: ReadonlySet<string>): readonly string[] {
  const lines = [...BAND_REMEDY].filter(([band]) => bands.has(band)).map(([, hint]) => `    ${hint}`);
  if (lines.length === 0) return [];

  return [
    '  What each band that moved usually means:',
    ...lines,
    '  If the movement is genuinely inherent to the subject — a real clock, a live feed —',
    '  mask the *element* rather than accept the subject: the component named above is it,',
    '  and an element-scoped ignore follows it when layout moves. Reach for that second, not',
    '  first: a mask hides the next regression that lands in the same place.',
  ];
}

const BAND_REMEDY: readonly (readonly [string, string])[] = [
  ['content', 'content — text or data moved: a clock, a random seed, an id counter, a request that had not landed'],
  ['geometry', 'geometry — the tree or its boxes moved: layout that had not settled, a measurement taken during a transition, a late-arriving image with no intrinsic size'],
  ['token', 'token — a declared style moved: a theme applied after first paint, a CSS-in-JS class name that carries a counter'],
  ['a11y', 'a11y — a role, name or state moved: focus landing somewhere between readings, an aria-live region updating itself'],
  ['texture', 'texture — the painted surface moved with nothing structural behind it'],
];

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
  const found = subjects.flatMap((o) => o.findings ?? []);

  if (found.length > 0) {
    // The dating rides the same line rather than waiting for `variance_findings`.
    // A reader who stops here stops on a count, and a count is the one shape of
    // this that reads as *you have introduced fourteen defects* whether or not
    // anything in the run said so.
    return [
      `findings: ${found.length} in ${subjects.length} subject(s), found without a baseline` +
        `${datingOf(found)
          .map((clause) => ` · ${clause}`)
          .join('')} — call variance_findings. These do not affect the verdict.`,
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
