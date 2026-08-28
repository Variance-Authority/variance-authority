import type { CliRunReport } from './run-report.js';
import { section, slug, text } from './report-html-elements.js';

/**
 * The two sections with no single comparison in them.
 *
 * One reads the suite against *itself* at one commit, the other reads this run
 * against every run before it. Neither can be phrased by looking at a pair of
 * images, which is why they are the sections a screenshot tool does not have.
 */

/* --- composition ---------------------------------------------------------- */

/**
 * The suite compared to *itself*, at one commit — the section with no baseline in
 * it anywhere.
 *
 * Three answers nothing else here can phrase. An **echo** is one rendering
 * reached through several subjects, which is why eleven diffs can be one review.
 * A **divergence** is one props digest producing two renderings at one commit,
 * which is either a fact about the design or a reading that is not repeatable.
 * And **unexplained** is the finding: a component moved, the ladder found no
 * edit, no token and no upstream, and `held` is the control group — the subjects
 * where the same component with the same props did not move.
 */
export function composition(report: CliRunReport): string {
  const composed = report.composition;
  if (composed === undefined) return '';

  const parts: string[] = [];

  if (composed.echoes.length > 0) {
    parts.push(
      '<h3>Echoes<span class="hint">one rendering, several subjects</span></h3><ul class="folds">' +
        composed.echoes
          .map(
            (echo) =>
              `<li><code>${text(echo.component)}</code>` +
              `<span class="n">${echo.subjects.length} subjects · ${echo.sites} sites</span>` +
              (echo.example === undefined
                ? '<span class="mark quiet" title="No subject exists that shows this component narrowly — every one of them is a page that contains it.">no example</span>'
                : `<a href="#s-${text(slug(echo.example))}"><code>${text(echo.example)}</code></a>`) +
              '</li>',
          )
          .join('') +
        '</ul>',
    );
  }

  if (composed.divergences.length > 0) {
    parts.push(
      '<h3>Divergences<span class="hint">same inputs, more than one rendering</span></h3><ul class="folds">' +
        composed.divergences
          .map(
            (divergence) =>
              `<li><code>${text(divergence.component)}</code>` +
              `<span class="n">${divergence.renderings.length} renderings</span>` +
              divergence.bands.map((band) => `<span class="mark band">${text(band)}</span>`).join('') +
              // The subjects, grouped and linked. Every other row on this page
              // ends somewhere a reader can click; this one used to end at a
              // count, which made the one finding a screenshot tool cannot
              // produce also the one finding this page could not be acted on.
              divergence.renderings
                .map((subjects) =>
                  subjects
                    .map(
                      (subject) =>
                        `<a href="#s-${text(slug(subject))}"><code>${text(subject)}</code></a>`,
                    )
                    .join(''),
                )
                .join('<span class="mark quiet">vs</span>') +
              '</li>',
          )
          .join('') +
        '</ul>',
    );
  }

  const unexplained = composed.movements.filter((move) => move.cause === 'unexplained');
  const explained = composed.movements.filter((move) => move.cause !== 'unexplained');

  if (composed.movements.length > 0) {
    parts.push(
      '<h3>Movement<span class="hint">edited → token → upstream → contradicted → unexplained</span></h3>' +
        '<table class="moves"><tbody>' +
        [...unexplained, ...explained]
          .map(
            (move) =>
              `<tr><td><span class="mark ${move.cause === 'unexplained' ? 'warn' : 'quiet'}">${text(move.cause)}</span></td>` +
              `<td><code>${text(move.component)}</code></td>` +
              `<td><a href="#s-${text(slug(move.subject))}"><code>${text(move.subject)}</code></a></td>` +
              `<td>${move.bands.map((band) => `<span class="mark band">${text(band)}</span>`).join('')}</td>` +
              `<td class="num">${move.alsoIn.length > 0 ? `+${move.alsoIn.length}` : ''}</td>` +
              `<td class="num held" title="Subjects where the same component with the same props did not move — the control group.">${
                move.held === undefined ? '' : `${move.held.length} held`
              }</td>` +
              `<td class="where">${text(move.because)}</td></tr>`,
          )
          .join('') +
        '</tbody></table>',
    );
  }

  if (parts.length === 0) return '';
  return section('Composition', `${composed.subjects.length} subjects joined at one commit`, parts.join(''));
}


/* --- what a single run cannot know --------------------------------------- */

/**
 * The instruments no comparison reaches, and the reason a store exists.
 *
 * Drift first because it is the one a review structurally cannot catch: a button
 * gains 2px eleven times, each approved correctly by somebody looking at one
 * diff, and the 22px is a number no review ever saw. Absent is never rendered as
 * zero anywhere here — a missing record means no store answered, and the reason
 * is in `warnings`.
 */
export function accumulated(report: CliRunReport): string {
  const parts: string[] = [];

  const drift = Object.entries(report.drift ?? {});
  if (drift.length > 0) {
    parts.push(
      '<h3>Drift<span class="hint">where a token has travelled, across approvals</span></h3><table class="moves"><tbody>' +
        drift
          .map(
            ([token, record]) =>
              `<tr><td><code>${text(token)}</code></td>` +
              `<td class="num"><span class="from">${text(record.from)}</span> → <b>${text(record.to)}</b></td>` +
              `<td class="num">${record.steps} steps</td>` +
              `<td class="num">${
                record.quantity === undefined
                  ? '<span class="nil">—</span>'
                  : `<b class="net">${record.quantity.net > 0 ? '+' : ''}${record.quantity.net}${text(record.quantity.unit)}</b>` +
                    ` <span class="quiet">largest ${record.quantity.largestStep}${text(record.quantity.unit)}</span>`
              }</td>` +
              `<td class="where">${text(record.because)}</td></tr>`,
          )
          .join('') +
        '</tbody></table>',
    );
  }

  const churn = Object.entries(report.churn ?? {});
  if (churn.length > 0) {
    parts.push(
      '<h3>Churn<span class="hint">how often this component moves</span></h3><table class="moves"><tbody>' +
        churn
          .map(
            ([component, record]) =>
              `<tr><td><code>${text(component)}</code></td>` +
              `<td class="num"><b>${record.changedRuns}</b><em>/${record.runs}</em></td>` +
              `<td class="num">${record.rejectedRuns > 0 ? `<span class="mark warn">${record.rejectedRuns} rejected</span>` : ''}</td>` +
              `<td class="num">${record.collateralRuns > 0 ? `<span class="mark quiet">${record.collateralRuns} displaced</span>` : ''}</td>` +
              `<td class="where">${text(record.because)}</td></tr>`,
          )
          .join('') +
        '</tbody></table>',
    );
  }

  const flakiness = Object.entries(report.flakiness ?? {});
  if (flakiness.length > 0) {
    parts.push(
      '<h3>Instability<span class="hint">occurrences per sweep, and how long since</span></h3><table class="moves"><tbody>' +
        flakiness
          .map(
            ([subject, record]) =>
              `<tr><td><a href="#s-${text(slug(subject))}"><code>${text(subject)}</code></a></td>` +
              `<td class="num"><b>${record.occurrences}</b><em>/${record.sweeps} sweeps</em></td>` +
              `<td class="num">${
                record.rate === undefined
                  ? '<span class="nil" title="No sweep has run, so there is no denominator. Never zero.">—</span>'
                  : `${(record.rate * 100).toFixed(0)}%`
              }</td>` +
              `<td class="num">${record.sweepsSince} since</td>` +
              `<td>${record.causes
                .map(
                  (cause) =>
                    `<span class="mark band">${text(cause.component ?? cause.band ?? '?')}</span>`,
                )
                .join('')}</td>` +
              `<td class="where">${text(record.because)}</td></tr>`,
          )
          .join('') +
        '</tbody></table>',
    );
  }

  if (parts.length === 0) return '';
  return section('Across runs', 'what one comparison cannot hold', parts.join(''));
}

