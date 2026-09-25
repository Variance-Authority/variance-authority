import type { SensitivityConfig } from '../config.js';
import {
  sensitivityShare,
  sensitivityState,
  type SensitivityLedger,
  type SensitivityUsage,
} from '@variance-authority/report';
import { scopedTo } from './ignores.js';
import type { CliObservationRecord } from './run-report.js';
import type { PlannedSubject } from './collector.js';

/**
 * What each declared sensitivity did this run, including the ones that did
 * nothing.
 *
 * The same accounting an ignore's ledger keeps, and it exists for the same
 * reason: **a declaration that stopped being needed is invisible without a count
 * of zero.** A route declared `layout` two years ago by somebody who has left is
 * a blind spot with a plausible-looking config entry in front of it, and the
 * only thing that finds it is a line saying it absorbed nothing again.
 *
 * Kept beside `ignores.ts` rather than inside it because the two answer opposite
 * questions and share one predicate. `scopedTo` decides reach for both — a rule
 * that applied on one path and not the other would be a hole shaped exactly like
 * the config — and everything else here is about a different sentence.
 */

export type { SensitivityLedger, SensitivityUsage };

export function sensitivityLedgerOf(
  rules: readonly SensitivityConfig[],
  planned: readonly PlannedSubject[],
  observations: readonly CliObservationRecord[],
): SensitivityLedger | undefined {
  if (rules.length === 0) return undefined;

  const usage = rules.map((rule): SensitivityUsage => {
    const scoped = planned.filter((subject) =>
      scopedTo(rule, {
        id: subject.subject.id,
        ...(subject.tags !== undefined ? { tags: subject.tags } : {}),
      }),
    );

    const absorbed = observations.filter((observation) => observation.relaxed?.rule === rule.id);
    const bands = new Set(absorbed.flatMap((observation) => observation.relaxed?.bands ?? []));

    return {
      rule: rule.id,
      reason: rule.reason,
      level: rule.level,
      scoped: scoped.length,
      absorbed: absorbed.map((observation) => observation.subject),
      bands: [...bands],
      unscoped: scoped.length === 0,
    };
  });

  return {
    rules: usage,
    totalAbsorbed: usage.reduce((sum, entry) => sum + entry.absorbed.length, 0),
  };
}

/**
 * The ledger as the lines a run prints.
 *
 * Stated in the *positive* form the operator wrote — "asserts on layout" — with
 * the absorption as the evidence beside it. "Asserts on layout" is a claim about
 * intent and "absorbed 38 token difference(s)" is what happened; printing only
 * the second would make the report a list of things that were hidden, and
 * printing only the first would make it a list of things somebody believes.
 */
export function summarizeSensitivities(ledger: SensitivityLedger | undefined): readonly string[] {
  if (ledger === undefined || ledger.rules.length === 0) return [];

  const lines = [
    `SENSITIVITY — ${ledger.totalAbsorbed} subject(s) not asserted on in full, ` +
      `by ${sensitivityShare(ledger)}`,
  ];

  for (const entry of ledger.rules) {
    const state = sensitivityState(entry);

    if (state === 'unscoped') {
      lines.push(
        `  [unscoped] ${entry.rule} — asserts on ${entry.level} and matched no subject this ` +
          `run planned (${entry.reason}); check the subjects and tags it names`,
      );
      continue;
    }

    if (state === 'dead') {
      lines.push(
        `  [dead] ${entry.rule} — asserts on ${entry.level} across ${entry.scoped} subject(s) ` +
          `and absorbed nothing (${entry.reason})`,
      );
      continue;
    }

    lines.push(
      `  ${entry.rule} — asserts on ${entry.level}; absorbed ${entry.bands.join('/')} ` +
        `difference(s) in ${entry.absorbed.length} of ${entry.scoped} subject(s): ${entry.reason}`,
    );
  }

  return lines;
}
