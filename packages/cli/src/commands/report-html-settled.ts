import { greenBecause, type Green } from '@variance-authority/report';
import { isShardFilter, type CliObservationRecord, type CliRunReport } from './run-report.js';
import { px, section, text } from './report-html-elements.js';

/**
 * The four segments of the census bar that are not findings.
 *
 * The bar draws the run's whole plan, and every segment on it is a button. Four
 * of them used to lead nowhere: `unchanged` and `ignored` because the pane is
 * built from the subjects that need review, `failed` and `excluded` because they
 * are not observations at all and have no verdict to be filtered by. Pressing any
 * of the four emptied the page, which is the one thing a coverage bar must never
 * do — a reader who asks *which ones were skipped* and is shown nothing has been
 * answered "none".
 *
 * ## Two renderers, because they are two kinds of record
 *
 * A settled subject was observed: it has a verdict, a pixel count, and usually a
 * declaration that decided it. A not-observed subject was never compared: it has
 * a kind and a sentence, and no number at all. One renderer over both would have
 * to invent a verdict for the second or drop the numbers from the first, and a
 * `0 px` beside a subject nobody measured is exactly the lie this page exists to
 * refuse — absent is not zero.
 *
 * Both are compact by design. These are the rows a reader scans for a name, not
 * the ones they open a picture from, and a stage per unchanged subject is three
 * hundred rasters nobody asked for.
 */

/**
 * The green subjects, and *which kind of green* each one is.
 *
 * `unchanged` was earned by a comparison. `ignored` was decided by something the
 * operator wrote down — a mask over a subtree, or a level this subject is not
 * asserted on — and the rule that did it is named here, because green by
 * declaration is the state that grows over a regression and the only defence is
 * that somebody can read the list.
 */
export function settled(observations: readonly CliObservationRecord[]): string {
  const green = observations.filter(
    (entry) => entry.verdict === 'unchanged' || entry.verdict === 'ignored',
  );
  if (green.length === 0) return '';

  const rows = green
    .map(
      (entry) =>
        `<div class="entry quiet hidden" data-subject="${text(entry.subject)}" ` +
        `data-verdict="${text(entry.verdict)}">` +
        `<i class="dot ${text(entry.verdict)}"></i>` +
        `<code>${text(entry.subject)}</code>` +
        because(entry) +
        pixels(entry) +
        '</div>',
    )
    .join('');

  return section(
    'Settled',
    'green, and which kind of green each one is',
    `<div class="entries">${rows}</div>`,
    'unchanged ignored',
    true,
  );
}

/**
 * What decided a green subject, written out.
 *
 * The reading itself is `greenBecause` in the report package, shared with the
 * review service's own settled list. Two surfaces answering *why is this green*
 * from the same record is the whole point: a page and a service that each
 * derived it would eventually disagree about one run in front of one person,
 * and the state they would disagree about first is `unsaid`.
 */
function because(entry: CliObservationRecord): string {
  const green: Green = greenBecause(entry);

  switch (green.kind) {
    case 'measured':
      return '';
    case 'masked':
      return `<span class="why">masked in ${green.boxes} place(s), and nothing differed under them</span>`;
    case 'relaxed':
      return (
        `<span class="why">asserted on ${text(green.level)}; ` +
        `<code>${text(green.rule)}</code> absorbed ${text(green.bands.join(', '))}</span>`
      );
    case 'unsaid':
      return '<span class="why unsaid">the run did not record which rule absorbed it</span>';
    default:
      return (
        '<span class="why">absorbed by ' +
        green.rules.map((rule) => `<code>${text(rule)}</code>`).join(', ') +
        '</span>'
      );
  }
}

/** Pixels a declaration took out of this subject, when the record kept them. */
function absorbed(entry: CliObservationRecord): number | undefined {
  const green = greenBecause(entry);
  return green.kind === 'absorbed' ? green.pixels : undefined;
}

/**
 * The pixel cell, empty when nobody absorbed any.
 *
 * A `0 px` under a subject a rule decided would be a measurement, and there is
 * none — either the difference was absorbed by a level rather than a mask, or
 * the record never said. The cell is left blank in both cases; the sentence
 * beside it is what carries the difference.
 */
function pixels(entry: CliObservationRecord): string {
  const absorbedHere = absorbed(entry);
  return `<span class="px">${absorbedHere === undefined ? '' : px(absorbedHere)}</span>`;
}

/**
 * The subjects with no observation, and the two opposite reasons for that.
 *
 * `failed` is a hole in this run's coverage; `excluded` is a decision somebody
 * already made and wrote down; `unreached` is the run having proved the change
 * cannot arrive. They are in one section because a reader arrives
 * here asking *what did this run not look at*, and on one list rather than two
 * because the census bar has already separated them and pressing either chip
 * narrows this to it.
 *
 * A shard's own filter is marked rather than listed as a decision: `--shard 2/4`
 * excludes three quarters of the suite by arithmetic, and a page that reported
 * that as three hundred exclusions would bury the one the operator wrote.
 */
export function notObserved(report: CliRunReport): string {
  const entries = report.notObserved ?? [];
  if (entries.length === 0) return '';

  const rows = entries
    .map(
      (entry) =>
        `<div class="entry" data-subject="${text(entry.subject)}" ` +
        `data-verdict="${text(entry.kind)}">` +
        `<i class="dot ${text(entry.kind)}"></i>` +
        `<code>${text(entry.subject)}</code>` +
        `<span class="why">${text(entry.because)}</span>` +
        (isShardFilter(entry)
          ? '<span class="mark quiet" title="Another shard observed this subject. ' +
            'Not a decision anybody made about it.">another shard</span>'
          : '') +
        '</div>',
    )
    .join('');

  return section(
    'Not observed',
    'what this run did not look at, and why',
    `<div class="entries">${rows}</div>`,
    'failed excluded unreached',
  );
}
