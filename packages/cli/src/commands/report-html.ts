import { clusterChanges, type Change, type ObservationRecord } from '@variance-authority/report';
import type { CliObservationRecord, CliRunReport } from './run-report.js';
import { docketOf, type Docket } from './docket.js';
import { chip, cmd, copy, markers, px, qualifier, section, slug, text } from './report-html-elements.js';
import { MARK, STYLE } from './report-html-style.js';
import { SCRIPT } from './report-html-script.js';
import { presentationImpact, subjects } from './report-html-subjects.js';
import { accumulated, composition } from './report-html-composition.js';
import { coverage } from './report-html-coverage.js';
import { notObserved, settled } from './report-html-settled.js';

/**
 * The run as one HTML page: the third angle on the same docket.
 *
 * Text answers *what happened* at a terminal, the pull-request body answers it in
 * a review thread, and neither can show a picture. This is the angle that can —
 * and it is deliberately the **cheapest rung of presentation infrastructure**:
 * one file, written by the same command that writes the JSON, uploaded as a CI
 * artifact by whatever already uploads CI artifacts. No service, no account, no
 * upload step, no retention policy, nothing to keep running.
 *
 * ## Why it is not a second opinion about the run
 *
 * Everything decided here is decided elsewhere — `docket.ts` for causes and
 * collateral, `clusterChanges` for what a single decision would settle. Adding a
 * fourth renderer must never add a fourth answer, so this file folds nothing it
 * can be handed: it receives values and turns them into elements. That is the
 * property that lets a hosted review surface render *the same docket* server-side
 * and be unable to disagree with the artifact in CI.
 *
 * ## Written for the tenth time it is opened, not the first
 *
 * A reviewer opens this most days, and prose they have already read is friction
 * every time after the first. So a qualification that used to be a sentence is a
 * **marker**: `by area` rather than "largest region, not a named cause", a red
 * `2 failed` segment in the coverage bar rather than "this is not a pass". None
 * of the information is dropped — dropping it is how a page starts lying about
 * coverage — it is compressed into something scannable, with the long form on the
 * `title` where a first-time reader can still find it.
 *
 * ## The two constraints a reader has to know
 *
 * **Image paths are relative to the report**, exactly as `ObservationRecord.images`
 * declares them, so this page belongs beside `report.json` rather than anywhere
 * else. The alternative — base64 data URIs, one genuinely portable file — would
 * make this function read the filesystem, and a formatter that can fail on ENOENT
 * is a formatter that cannot be tested by handing it a value.
 *
 * **No network, of any kind.** No stylesheet, no font file, no analytics, no
 * image host. A page that fetches anything renders differently in the reviewer's
 * browser than it did in CI, which is a peculiar failure for this project of all
 * projects to ship. The script is inline and is the comparison itself — a wipe, a
 * blend, a region overlay — which is the part of reviewing a change that a static
 * arrangement of three pictures cannot do.
 */

export function reportHtml(report: CliRunReport): string {
  const docket = docketOf(report);
  const reviewable = report.observations.filter((entry) => needsReview(entry.verdict));
  const clustering = clusterChanges(report.observations);

  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${text(title(docket))}</title>`,
    `<style>${STYLE}</style>`,
    `</head><body data-status="${text(statusOf(docket))}">`,
    masthead(report, docket),
    '<main>',
    rail(report, docket, reviewable),
    '<div class="pane">',
    clusters(clustering.changes, clustering.ungrouped),
    subjects(reviewable),
    presentationImpact(report.observations),
    composition(report),
    accumulated(report),
    settled(report.observations),
    notObserved(report),
    coverage(report, docket),
    '</div>',
    '</main>',
    `<script>${SCRIPT}</script>`,
    '</body></html>',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/** Both green verdicts are excluded, for the reason `Docket.reviewable` gives. */
function needsReview(verdict: ObservationRecord['verdict']): boolean {
  return verdict !== 'unchanged' && verdict !== 'ignored';
}

function statusOf(docket: Docket): 'incomplete' | 'review' | 'clean' {
  if (docket.failed.length > 0) return 'incomplete';
  return docket.reviewable > 0 ? 'review' : 'clean';
}

/**
 * The browser tab, which is the part read in a strip 20 characters wide.
 *
 * Counts first and the leading cause after, because a tab is scanned rather than
 * read and the number is what decides whether to switch to it.
 */
function title(docket: Docket): string {
  const parts: string[] = [];
  if (docket.reviewable > 0) parts.push(`${docket.reviewable} to review`);
  if (docket.failed.length > 0) parts.push(`${docket.failed.length} failed`);
  if (parts.length === 0) parts.push('clean');
  const [first] = docket.causes;
  return `${parts.join(' · ')}${first === undefined ? '' : ` · ${first.label}`} — variance`;
}

/* --- the masthead --------------------------------------------------------- */

/**
 * Identity above the findings rather than in a footer.
 *
 * A visual report read on a different machine from the one that painted it is the
 * normal case, and the identity is what says whether the two are even comparable.
 * Putting it where a reader has already scrolled past would make it a detail; it
 * is the precondition for every image below being meaningful. It is a row of
 * chips rather than a definition list because after the first read it is checked,
 * not read — the eye goes to one field.
 */
function masthead(report: CliRunReport, docket: Docket): string {
  const { identity } = report;
  const chips: string[] = [];

  if (report.run !== undefined) {
    chips.push(chip('run', report.run.id));
    chips.push(chip('commit', report.run.commit.slice(0, 10), report.run.commit));
  }
  chips.push(chip('at', report.at));
  chips.push(
    chip(
      'renderer',
      `${identity.renderer} ${identity.engine} ${identity.platform} @${identity.deviceScaleFactor}x`,
    ),
  );
  chips.push(chip('baselines', report.retention));
  if (identity.fonts.length > 0) {
    chips.push(chip('fonts', String(identity.fonts.length), identity.fonts.join('\n')));
  }
  if (report.stabilization !== undefined && report.stabilization.length > 0) {
    chips.push(
      chip('held still', String(report.stabilization.length), report.stabilization.join('\n')),
    );
  }

  return (
    '<header>' +
    `<div class="brand">${MARK}<span>variance</span></div>` +
    headline(docket) +
    (report.intent === undefined ? '' : `<p class="intent">${text(report.intent)}</p>`) +
    `<div class="chips">${chips.join('')}</div>` +
    census(report, docket) +
    '</header>'
  );
}

/**
 * The one line, and it names the thing rather than counting it.
 *
 * The counts are in the bar directly below and would be duplicated here; what a
 * bar cannot say is *what happened*, and after the tenth read that is the only
 * word being looked for. `incomplete` outranks a cause because a run that failed
 * to observe subjects has no standing to lead with a finding.
 */
function headline(docket: Docket): string {
  const status = statusOf(docket);
  if (status === 'incomplete' && docket.reviewable === 0) {
    return '<h1 class="bad">incomplete</h1>';
  }
  if (status === 'clean') return '<h1 class="ok">clean</h1>';
  const [first, ...rest] = docket.causes;
  const lead =
    first === undefined
      ? `${docket.reviewable} to review`
      : `${text(first.label)}${first.named ? '' : '<span class="mark area">by area</span>'}`;
  return (
    `<h1>${lead}` +
    (rest.length === 0 ? '' : `<span class="more">+${rest.length} more</span>`) +
    (status === 'incomplete' ? `<span class="mark warn">${docket.failed.length} failed</span>` : '') +
    '</h1>'
  );
}

/**
 * Every subject the run planned, as one bar, in proportion.
 *
 * This is where a coverage hole is refused, and it is refused by arithmetic
 * rather than by a sentence: the segments are the run's whole plan, so a red
 * `failed` segment is *visibly* part of the same bar as the green one and cannot
 * be read past. A page that listed only findings would look complete on a run
 * that failed to observe half the suite.
 */
function census(report: CliRunReport, docket: Docket): string {
  const counted = new Map<string, number>();
  for (const observation of report.observations) {
    counted.set(observation.verdict, (counted.get(observation.verdict) ?? 0) + 1);
  }

  const segments: [string, number][] = [
    ['changed', counted.get('changed') ?? 0],
    ['new', counted.get('new') ?? 0],
    ['incomparable', counted.get('incomparable') ?? 0],
    ['failed', docket.failed.length],
    ['ignored', counted.get('ignored') ?? 0],
    ['excluded', docket.excluded],
    ['unreached', docket.unreached],
    ['unchanged', counted.get('unchanged') ?? 0],
  ];
  const total = segments.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return '';

  const bar = segments
    .filter(([, n]) => n > 0)
    .map(
      ([name, n]) =>
        `<i class="seg ${name}" style="flex:${n}" title="${n} ${text(name)}"></i>`,
    )
    .join('');

  const keys = segments
    .filter(([, n]) => n > 0)
    .map(
      ([name, n]) =>
        `<button type="button" class="key ${name}" data-filter="${text(name)}">` +
        `<i></i><b>${n}</b> ${text(name)}</button>`,
    )
    .join('');

  return `<div class="census"><div class="bar">${bar}</div><div class="keys">${keys}</div></div>`;
}

/* --- the rail ------------------------------------------------------------- */

/**
 * What is worth looking at, in the order a reviewer should look at it.
 *
 * Causes above subjects because the decision is nearly always about a component
 * and only incidentally about a subject: forty stories moved, one thing changed.
 * It is a filter rather than a table of contents — clicking a cause narrows the
 * pane to the subjects it reached, which is the motion the docket exists to make
 * possible.
 */
function rail(
  report: CliRunReport,
  docket: Docket,
  reviewable: readonly CliObservationRecord[],
): string {
  const causes = docket.causes
    .map((entry) => {
      const marker = qualifier(entry);
      return (
        `<button type="button" class="cause" data-subjects="${text(entry.subjects.join(' '))}">` +
        `<span class="name">${entry.named ? `<code>${text(entry.label)}</code>` : text(entry.label)}</span>` +
        marker +
        `<span class="n">${entry.subjects.length}</span>` +
        (entry.files.length === 0
          ? ''
          : `<span class="file">${text(entry.files[0] ?? '')}</span>`) +
        `<span class="px">${px(entry.pixels)}</span>` +
        '</button>'
      );
    })
    .join('');

  const list = [
    ...reviewable.map(
      (entry) =>
        `<a class="row" href="#s-${text(slug(entry.subject))}" data-verdict="${text(entry.verdict)}" ` +
        `data-subject="${text(entry.subject)}">` +
        `<i class="dot ${text(entry.verdict)}"></i>` +
        `<code>${text(entry.subject)}</code>` +
        markers(entry) +
        `<span class="px">${px(entry.changedPixels)}</span>` +
        '</a>',
    ),
    ...report.observations
      .filter((entry) => !needsReview(entry.verdict))
      .map((entry) => quiet(entry.subject, entry.verdict, '#Settled')),
    ...(report.notObserved ?? []).map((entry) =>
      quiet(entry.subject, entry.kind, '#Not-observed'),
    ),
  ].join('');

  return (
    '<nav class="rail">' +
    '<input type="search" id="filter" placeholder="filter  /" autocomplete="off" spellcheck="false">' +
    (causes === '' ? '' : `<h2>Causes</h2><div class="causes">${causes}</div>`) +
    (list === '' ? '' : `<h2>Subjects</h2><div class="rows">${list}</div>`) +
    '</nav>'
  );
}
/**
 * A rail row for a subject that is not a finding.
 *
 * Present so that every segment of the census bar narrows this list to something,
 * and `quiet` so that it does not lengthen the rail on arrival — the default view
 * is what needs review, and three hundred unchanged rows above it would bury the
 * four that do. It carries no pixel count: `unchanged` is zero by definition and
 * a subject nobody observed has no number at all, so a column of `0px` here would
 * be one lie printed twice.
 */
function quiet(subject: string, verdict: string, anchor: string): string {
  return (
    `<a class="row quiet hidden" href="${anchor}" data-verdict="${text(verdict)}" ` +
    `data-subject="${text(subject)}">` +
    `<i class="dot ${text(verdict)}"></i>` +
    `<code>${text(subject)}</code>` +
    '</a>'
  );
}

/* --- clusters ------------------------------------------------------------- */

/**
 * The distinct things that happened, above the subjects they happened to.
 *
 * A token edit across forty stories is one decision, and the fingerprint is what
 * makes that a fact rather than an impression: same shape, position removed. The
 * number that matters is `settles` — how much of the review one command would
 * finish — and it is separate from `subjects` because everywhere else something
 * the shape does not name also moved, and accepting there would promote an
 * unreviewed difference alongside a reviewed one.
 */
function clusters(changes: readonly Change[], ungrouped: readonly string[]): string {
  if (changes.length === 0 && ungrouped.length === 0) return '';

  const rows = changes
    .map((change) => {
      const settles = change.settles.length;
      const touches = change.subjects.length;
      return (
        '<li>' +
        '<div class="head">' +
        (change.component === undefined
          ? '<span class="mark area" title="Grouped by silhouette alone — no component was attributed, so a bulk decision here is the weaker claim.">shape only</span>'
          : `<code class="comp">${text(change.component)}</code>`) +
        (change.file === undefined ? '' : `<span class="file">${text(change.file)}</span>`) +
        `<span class="grow"></span>` +
        `<span class="settles${settles === 0 ? ' none' : ''}" title="Subjects where this shape is the whole change, and a single decision settles them.">${settles}<em>/${touches}</em></span>` +
        '</div>' +
        `<div class="fp">${copy(change.fingerprint)}</div>` +
        '<div class="cmds">' +
        cmd(`variance accept --shape ${change.fingerprint}`) +
        cmd(ignoreSnippet(change), 'ignore rule') +
        '</div>' +
        `<div class="subs">${change.subjects
          .map(
            (subject) =>
              `<a href="#s-${text(slug(subject))}"${
                change.settles.includes(subject) ? '' : ' class="partial" title="Something this shape does not name also moved here, so --shape will not settle it."'
              }><code>${text(subject)}</code></a>`,
          )
          .join('')}</div>` +
        '</li>'
      );
    })
    .join('');

  const orphans =
    ungrouped.length === 0
      ? ''
      : `<p class="ungrouped"><span class="mark warn" title="These subjects changed and produced no fingerprint — nothing to group them by, and never folded into a catch-all.">${ungrouped.length} ungrouped</span>` +
        ungrouped.map((subject) => `<code>${text(subject)}</code>`).join('') +
        '</p>';

  return section(
    'Changes',
    'distinct shapes, most settling first',
    `<ol class="clusters">${rows}</ol>${orphans}`,
    'changed',
  );
}

/** The rule as it would be pasted, from `docs/ignores.md`. Never invented here. */
function ignoreSnippet(change: Change): string {
  return JSON.stringify(
    {
      ignore: [
        {
          id: change.component === undefined ? 'name-me' : change.component.toLowerCase(),
          reason: 'why this is not the subject',
          fingerprints: [change.fingerprint],
        },
      ],
    },
    null,
    2,
  );
}
