import {
  absorbedBands,
  ignoreSays,
  ignoreState,
  ignoreTotals,
  isActionable,
  sensitivitySays,
  sensitivityState,
  sensitivityTotals,
  type IgnoreLedger,
  type IgnoreUsage,
  type SensitivityLedger,
  type SensitivityUsage,
} from '@variance-authority/report';
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

  if (report.ignores !== undefined) parts.push(ignoreLedger(report.ignores));
  if (report.sensitivities !== undefined) parts.push(sensitivityLedger(report.sensitivities));

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

/* --- the declaration ledgers ---------------------------------------------- */

/**
 * What each ignore rule absorbed, including the rules that absorbed nothing.
 *
 * The audit surface, and the reason ignores are safe to have at all: a mask
 * grows over a real regression silently, and the only thing that catches it is a
 * line saying the rule took nothing again. So every rule is a row — filtering the
 * quiet ones out would delete exactly the finding.
 *
 * Both numbers a rule has are printed, because one of them is a denominator.
 * *Absorbed nothing in nine compared subjects* is a rule to delete; *absorbed
 * nothing in nine subjects, none of which was compared* is a rule this run knows
 * nothing about, and a table with one column cannot tell them apart — which is
 * how a fresh checkout came to report every ignore in the config as dead.
 */
function ignoreLedger(ledger: IgnoreLedger): string {
  if (ledger.rules.length === 0) return '';

  const rows = ledger.rules.map((entry) => {
    const state = ignoreState(entry);
    return (
      `<tr class="${text(state)}"><td><code>${text(entry.rule)}</code></td>` +
      `<td>${badge(state, ignoreSays(entry, ledger))}</td>` +
      `<td class="num">${entry.pixels === 0 ? '<span class="none">none</span>' : px(entry.pixels)}</td>` +
      `<td class="num">${scope(entry)}</td>` +
      `<td class="where">${text(entry.reason)}</td></tr>`
    );
  });

  return (
    `<h3>Ignores<span class="hint">what each rule absorbed, and what it did not</span></h3>` +
    `<table class="moves ledger"><tbody>${rows.join('')}</tbody></table>` +
    `<p class="note">${text(ignoreTotals(ledger))}</p>`
  );
}

/** The two counts, written so neither can be read as the other. */
function scope(entry: IgnoreUsage): string {
  if (entry.subjects === 0) return '<span class="none">nowhere</span>';
  return (
    `${entry.subjects}<em>subj</em>` +
    (entry.comparedIn === entry.subjects
      ? ''
      : ` <span class="none">${entry.comparedIn} compared</span>`)
  );
}

/**
 * What each sensitivity relaxed, stated in the positive form the operator wrote.
 *
 * "Asserts on layout" is a claim about intent and "absorbed 38 token differences"
 * is what happened. A table with only the second is a list of things that were
 * hidden; one with only the first is a list of things somebody believes.
 */
function sensitivityLedger(ledger: SensitivityLedger): string {
  if (ledger.rules.length === 0) return '';

  const rows = ledger.rules.map((entry) => {
    const state = sensitivityState(entry);
    return (
      `<tr class="${text(state)}"><td><code>${text(entry.rule)}</code></td>` +
      `<td>${badge(state, sensitivitySays(entry))}</td>` +
      `<td><span class="mark quiet">asserts on ${text(entry.level)}</span></td>` +
      `<td class="num">${
        entry.scoped === 0
          ? '<span class="none">nowhere</span>'
          : `${entry.absorbed.length}<em>of</em>${entry.scoped}`
      }</td>` +
      `<td class="where">${bands(entry)}${text(entry.reason)}</td></tr>`
    );
  });

  return (
    '<h3>Sensitivities<span class="hint">what each rule relaxed, and what it did not</span></h3>' +
    `<table class="moves ledger"><tbody>${rows.join('')}</tbody></table>` +
    `<p class="note">${text(sensitivityTotals(ledger))}</p>`
  );
}

/**
 * The bands, drawn from the one function that knows they can be missing.
 *
 * The `undefined` arm is not decoration. A sensitivity that decided verdicts with
 * no band kept is a report that lost the detail, and a blank cell there would say
 * the rule absorbed nothing — the opposite of what happened.
 */
function bands(entry: SensitivityUsage): string {
  const found = absorbedBands(entry);
  if (found === undefined) {
    return (
      '<span class="mark quiet" title="This report did not record which bands were absorbed.">' +
      'bands not recorded</span> '
    );
  }
  if (found.length === 0) return '';
  return `${found.map((band) => `<span class="mark quiet">${text(band)}</span>`).join('')} `;
}

/**
 * A rule's state as one word, marked when it is a word somebody has to act on.
 *
 * The word is `ignoreState`'s and `sensitivityState`'s, never this file's. A
 * renderer that decided for itself what *dead* means is how the previous version
 * of this table came to call every rule in a fresh checkout dead.
 */
function badge(state: string, says: string): string {
  const kind = isActionable(state as Parameters<typeof isActionable>[0]) ? 'warn' : 'quiet';
  return `<span class="mark ${kind}" title="${text(says)}">${text(state)}</span>`;
}
