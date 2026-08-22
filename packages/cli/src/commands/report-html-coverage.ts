import type { CliRunReport } from './run-report.js';
import type { Docket } from './docket.js';
import { px, section, text } from './report-html-elements.js';

/**
 * What was not looked at, and what was altered in order to be.
 *
 * Last on the page and never absent when it has content. The census bar at the
 * top has already refused to let a failure read as a pass by arithmetic; this
 * is where the reader goes to find out which subjects those were.
 */

/* --- coverage ------------------------------------------------------------- */

/**
 * What was not looked at, and what looked differently than it says on the tin.
 *
 * Last on the page and never absent when it has content, because the census bar
 * at the top has already refused to let a failure read as a pass; this is where
 * the reader goes to find out which subjects those were.
 */
export function coverage(report: CliRunReport, docket: Docket): string {
  const parts: string[] = [];

  if (docket.failed.length > 0) {
    parts.push(
      '<ul class="failed">' +
        docket.failed
          .map(
            (entry) =>
              `<li><i class="dot failed"></i><code>${text(entry.subject)}</code>` +
              `<span class="where">${text(entry.because)}</span></li>`,
          )
          .join('') +
        '</ul>',
    );
  }

  if (docket.missingFonts.size > 0) {
    parts.push(
      '<p class="strip">' +
        [...docket.missingFonts]
          .map(
            ([family, subjectCount]) =>
              `<span class="mark warn font" title="Rendered with a substituted font in ${subjectCount} subject(s).">${text(family)} ×${subjectCount}</span>`,
          )
          .join('') +
        '</p>',
    );
  }

  const ledger = report.ignores;
  if (ledger !== undefined) {
    parts.push(ledgerTable('Ignores', ledger));
  }
  const sensitivities = report.sensitivities;
  if (sensitivities !== undefined) {
    parts.push(ledgerTable('Sensitivities', sensitivities));
  }

  if (report.warnings !== undefined && report.warnings.length > 0) {
    parts.push(
      '<ul class="warnings">' +
        report.warnings.map((warning) => `<li>${text(warning)}</li>`).join('') +
        '</ul>',
    );
  }

  if (report.stabilization !== undefined && report.stabilization.length > 0) {
    parts.push(
      '<p class="strip">' +
        report.stabilization
          .map((held) => `<span class="mark quiet">${text(held)}</span>`)
          .join('') +
        '</p>',
    );
  }

  if (parts.length === 0) return '';
  return section('Coverage', 'what was not looked at, and what was altered to be', parts.join(''));
}

/**
 * A declaration ledger, including the rules that did nothing.
 *
 * A rule that absorbed nothing is the state that turns an ignore into a blind
 * spot, so it is rendered rather than filtered — with a marker, because that is
 * the row a reviewer is looking for.
 */
function ledgerTable(name: string, ledger: unknown): string {
  const rules = Array.isArray((ledger as { rules?: unknown }).rules)
    ? ((ledger as { rules: readonly Record<string, unknown>[] }).rules)
    : [];
  if (rules.length === 0) return '';

  return (
    `<h3>${text(name)}<span class="hint">including the rules that caught nothing</span></h3>` +
    '<table class="moves"><tbody>' +
    rules
      .map((rule) => {
        const id = String(rule['id'] ?? rule['rule'] ?? '—');
        const pixels = typeof rule['pixels'] === 'number' ? rule['pixels'] : undefined;
        const dead = pixels === 0;
        return (
          `<tr><td><code>${text(id)}</code></td>` +
          `<td class="num">${pixels === undefined ? '' : px(pixels)}</td>` +
          `<td>${dead ? '<span class="mark warn" title="This rule absorbed nothing in this run.">caught nothing</span>' : ''}</td>` +
          `<td class="where">${text(String(rule['reason'] ?? rule['because'] ?? ''))}</td></tr>`
        );
      })
      .join('') +
    '</tbody></table>'
  );
}

