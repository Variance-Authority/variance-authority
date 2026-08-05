import { matchesGlob } from '@variance-authority/core';
import type { IgnoreConfig } from '../config.js';
import type { CliObservationRecord } from './run-report.js';

/**
 * The run-level ignore register (spec 0024, part 3).
 *
 * Per-subject counts arrive on each observation; this folds them into the answer
 * an operator actually needs, which is about *rules* rather than about subjects:
 * what did each one absorb, in how many subjects, and — the only question that
 * matters six months later — **did it absorb anything at all**.
 *
 * A rule that caught nothing is the point of the whole file. It is either a flake
 * that has been fixed, in which case the rule is a hole that should close, or a
 * selector that stopped matching, in which case something is being reported that
 * the operator believes is silenced. Both are worth a line, and neither is
 * visible from any per-subject number.
 *
 * The clock is the caller's. `until` is compared against a date passed in, so the
 * behaviour on the day a rule expires is a test rather than a wait.
 */

export interface IgnoreUsage {
  readonly rule: string;
  readonly reason: string;

  /** Changed pixels this rule absorbed across the run. */
  readonly pixels: number;

  /** Subjects where it excluded something, whether or not it absorbed anything. */
  readonly subjects: number;

  /**
   * Subjects where it excluded something **and a comparison happened**.
   *
   * The denominator that stops "absorbed nothing" from being an accusation. A
   * subject that is `new`, `incomparable`, or settled from a digest compared no
   * pixels, so an ignore over it had nothing to absorb — which says nothing at
   * all about whether the rule is still needed. Without this a fresh checkout
   * reported every ignore in the config as dead.
   */
  readonly comparedIn: number;

  /** Subjects where it excluded something and absorbed nothing there. */
  readonly inertIn: number;

  /** `true` when it never resolved to a place in any subject. */
  readonly unresolved: boolean;

  /**
   * Tags the rule names that no subject in this run wears.
   *
   * The only defence a tag has. A misspelled *key* is refused by name because
   * the config's objects are closed; a misspelled *tag* is a legal word that
   * simply matches nothing, and the rule then silently applies nowhere while the
   * operator reads their config and believes it applies somewhere. So the words
   * nothing answered to are named, with the near-misses that were present, and
   * an empty list is the ordinary case rather than the interesting one.
   */
  readonly unwornTags: readonly string[];

  /** `true` when it is past `until` and no longer absorbing. */
  readonly expired: boolean;
}

export interface IgnoreLedger {
  readonly rules: readonly IgnoreUsage[];

  /**
   * Rules that absorbed nothing anywhere this run.
   *
   * The list an operator is meant to act on. Named separately rather than left
   * to be derived, because a derivation nobody writes is a report nobody reads.
   */
  readonly dead: readonly string[];

  /** Subjects whose only differences were absorbed. Green, and not `unchanged`. */
  readonly fullyIgnored: readonly string[];

  readonly totalPixels: number;

  /** Every tag worn by a subject this run planned, for the near-miss hint. */
  readonly vocabulary: readonly string[];
}

/**
 * The rules that still absorb, for the collector to resolve.
 *
 * Filtered here rather than in the collectors, which have no clock and should not
 * acquire one: what a collector is asked to find is a run-level decision, and a
 * browser is the wrong place to make it. An expired rule is simply not sent, so
 * the differences it used to absorb come back with no further machinery.
 */
/**
 * Whether a rule is scoped to this subject, by name and by what it declares.
 *
 * One function, called from the two places scope is decided — what crosses into
 * the page, and which shapes a comparison absorbs — because a rule that applied
 * on one path and not the other would be a hole shaped exactly like the config.
 *
 * Every stated scope must hold. `subjects` and `tags` intersect rather than
 * union: an ignore is the one setting that makes a run less observant, so where
 * two readings exist the narrower is correct, and a union is two rules.
 */
export function scopedTo(
  rule: { readonly subjects?: readonly string[]; readonly tags?: readonly string[] },
  subject: { readonly id: string; readonly tags?: readonly string[] },
): boolean {
  if (
    rule.subjects !== undefined &&
    !rule.subjects.some((pattern) => matchesGlob(subject.id, pattern))
  ) {
    return false;
  }

  if (rule.tags !== undefined) {
    const worn = new Set(subject.tags ?? []);
    if (!rule.tags.some((tag) => worn.has(tag))) return false;
  }

  return true;
}

export function liveIgnores(
  rules: readonly IgnoreConfig[],
  now: string | undefined,
): readonly IgnoreConfig[] {
  return rules.filter((rule) => !isExpired(rule, now));
}

export function ledgerOf(
  rules: readonly IgnoreConfig[],
  observations: readonly CliObservationRecord[],
  now?: string,
  /** Every tag worn by a subject this run planned. Absent means nothing declared any. */
  worn?: Iterable<string>,
): IgnoreLedger | undefined {
  if (rules.length === 0) return undefined;

  const vocabulary = new Set(worn ?? []);

  const usage = new Map(
    rules.map((rule) => [
      rule.id,
      { pixels: 0, subjects: 0, comparedIn: 0, inertIn: 0, expired: isExpired(rule, now) },
    ]),
  );

  for (const observation of observations) {
    // `new` and `incomparable` compared nothing, so nothing could be absorbed.
    // Counting them would make an untested rule indistinguishable from a stale
    // one — see `IgnoreUsage.comparedIn`.
    const compared = COMPARED.includes(observation.verdict);

    for (const [id, pixels] of Object.entries(observation.ignored?.byRule ?? {})) {
      const entry = usage.get(id);
      // A mark whose rule is not in the config is a marker attribute in somebody's
      // markup. It is a real declaration and it is accounted for on the subject
      // that carries it; what it is not is a line in a ledger of rules the config
      // named, so it is skipped here rather than invented into one.
      if (entry === undefined) continue;

      entry.subjects += 1;
      entry.pixels += pixels;
      if (compared) entry.comparedIn += 1;
      if (compared && pixels === 0) entry.inertIn += 1;
    }
  }

  const summarized = rules.map((rule) => {
    const entry = usage.get(rule.id)!;
    return {
      rule: rule.id,
      reason: rule.reason,
      pixels: entry.pixels,
      subjects: entry.subjects,
      comparedIn: entry.comparedIn,
      inertIn: entry.inertIn,
      unresolved: entry.subjects === 0,
      // Only when the run had a vocabulary to check against. A route plan reads
      // no artifact that declares tags, so *every* tag would look unworn — and
      // an audit that fires on the suites it cannot judge is an audit nobody
      // reads on the ones it can.
      unwornTags:
        vocabulary.size === 0 ? [] : (rule.tags ?? []).filter((tag) => !vocabulary.has(tag)),
      expired: entry.expired,
    };
  });

  return {
    rules: summarized,
    // Two ways to be dead, and only one of them needs a comparison.
    //
    // *Resolved nowhere* is decided by collection alone: the selector matched no
    // element in any subject, which is true whatever the verdicts were. *Resolved
    // and took nothing* needs a comparison to have happened, because a subject
    // that is `new` or `incomparable` compared no pixels — so an ignore over it
    // had nothing to absorb, and calling that dead tells an operator to delete
    // their config on the run that proves least about it.
    dead: summarized
      .filter(
        (entry) =>
          !entry.expired && (entry.unresolved || (entry.pixels === 0 && entry.comparedIn > 0)),
      )
      .map((entry) => entry.rule),
    fullyIgnored: observations
      .filter((observation) => observation.verdict === 'ignored')
      .map((observation) => observation.subject),
    totalPixels: summarized.reduce((sum, entry) => sum + entry.pixels, 0),
    vocabulary: [...vocabulary].sort(),
  };
}

/**
 * The ledger as the lines a run prints.
 *
 * Absorption first, because it is what changed the verdict; then the rules that
 * caught nothing, because they are what somebody has to decide about. A ledger
 * where every rule is working returns one line, and a run with no ignores prints
 * nothing at all — the output before this existed.
 */
export function summarizeLedger(ledger: IgnoreLedger | undefined): readonly string[] {
  if (ledger === undefined) return [];

  const lines: string[] = [];

  if (ledger.totalPixels > 0) {
    lines.push(
      `IGNORED — ${ledger.totalPixels} pixel(s) absorbed by ${ledger.rules.length} rule(s)` +
        (ledger.fullyIgnored.length > 0
          ? `; ${ledger.fullyIgnored.length} subject(s) differed only there`
          : ''),
    );
  }

  for (const entry of ledger.rules) {
    if (entry.expired) {
      lines.push(
        `  [expired] ${entry.rule} — past its date; the differences it absorbed are being ` +
          'reported again',
      );
      continue;
    }
    if (entry.unwornTags.length > 0) {
      lines.push(
        `  [unworn] ${entry.rule} — no subject in this run carries ` +
          `${entry.unwornTags.map((tag) => `\`${tag}\``).join(', ')}` +
          `${nearMiss(entry.unwornTags, vocabularyOf(ledger))}; the rule applied nowhere`,
      );
      continue;
    }
    if (entry.unresolved) {
      lines.push(
        `  [dead] ${entry.rule} — matched nothing in any subject (${entry.reason}); either it ` +
          'is no longer needed, or its selector stopped matching and something you believe is ' +
          'silenced is being reported',
      );
      continue;
    }
    if (entry.pixels === 0 && entry.comparedIn === 0) {
      lines.push(
        `  ${entry.rule} — excluded a subtree in ${entry.subjects} subject(s), none of which ` +
          `was compared this run (${entry.reason}); nothing here says whether it is still needed`,
      );
      continue;
    }
    if (entry.pixels === 0) {
      lines.push(
        `  [dead] ${entry.rule} — excluded a subtree in ${entry.subjects} subject(s), ` +
          `${entry.comparedIn} of them compared, and absorbed nothing (${entry.reason})`,
      );
      continue;
    }
    lines.push(
      `  ${entry.rule} — ${entry.pixels}px in ${entry.subjects} subject(s): ${entry.reason}`,
    );
  }

  return lines;
}

/**
 * Whether a rule is past its date, comparing *days* rather than instants.
 *
 * `until` is a date and the run's clock is a timestamp, so a naive comparison
 * expires a rule at `00:00:00.001` **on** the day it names — a full day early,
 * every time, in production. Only the tests were passing a bare `YYYY-MM-DD`,
 * which is why they agreed with the documentation and the binary did not.
 *
 * The date the run happened is its own first ten characters, which is UTC — the
 * same calendar `until` is written in when nobody says otherwise, and a choice
 * worth stating: a team near a date boundary sees a rule expire on the UTC day,
 * not on theirs. A timezone in a config file would be a fourth thing to get
 * wrong for a field whose whole job is to be approximately right, once.
 */
/**
 * Verdicts that mean a comparison actually happened.
 *
 * `new` has no baseline and `incomparable` refused, so neither compared a pixel.
 * Both are legitimate outcomes and neither is evidence about an ignore.
 */
const COMPARED: readonly string[] = ['unchanged', 'changed', 'ignored'];

/**
 * A tag one edit away from an unworn one, for the message.
 *
 * The single most likely cause of an unworn tag is a typo, and naming the word
 * that *is* worn turns a report into a fix. Restricted to distance 1 on purpose:
 * a looser threshold starts suggesting `test` for `toast`, and a wrong suggestion
 * in a diagnostic is worse than none.
 */
function nearMiss(unworn: readonly string[], vocabulary: readonly string[]): string {
  for (const tag of unworn) {
    const near = vocabulary.find((candidate) => distanceIsOne(tag, candidate));
    if (near !== undefined) return ` (did you mean \`${near}\`?)`;
  }
  return '';
}

/** Every tag any rule in this ledger was checked against. */
function vocabularyOf(ledger: IgnoreLedger): readonly string[] {
  return ledger.vocabulary;
}

/** One insertion, deletion or substitution apart. Nothing cleverer. */
function distanceIsOne(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let seen = false;

  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (seen) return false;
    seen = true;
    if (shorter.length === longer.length) i += 1;
    j += 1;
  }

  return true;
}

function isExpired(rule: IgnoreConfig, now: string | undefined): boolean {
  if (rule.until === undefined || now === undefined) return false;
  if (Number.isNaN(Date.parse(rule.until)) || Number.isNaN(Date.parse(now))) return false;

  // `until` is the last day it holds, not the first day it does not.
  return now.slice(0, 10) > rule.until.slice(0, 10);
}
