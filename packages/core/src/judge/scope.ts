import type { NodePath } from '../format/snapshot.js';

/**
 * Who a declaration applies to, and when it has stopped.
 *
 * Four predicates and no policy. They are together because they are the whole of
 * *scope* — a rule reaches a subject, a subtree, and a date — and apart from
 * `ignore.ts` because more than one thing asks: an ignore, a sensitivity, and
 * whatever declares itself next. A second implementation of "does this glob
 * match" is how two config keys come to mean subtly different things while
 * looking identical in the documentation.
 */

/** The scope fields every declaration shares. */
export interface Scoped {
  readonly subjects?: readonly string[];
  readonly until?: string;
}

/**
 * Whether a rule is past its date, comparing *days* rather than instants.
 *
 * `until` names a day and a caller's clock is usually a timestamp, so comparing
 * them directly expires a rule at one millisecond past midnight **on** the day it
 * names — a full day early. The date a run happened is its own first ten
 * characters, which is UTC: the same calendar `until` is written in when nobody
 * says otherwise, and a choice worth stating, since a team near a boundary sees a
 * rule expire on the UTC day rather than on theirs.
 *
 * `until` is the last day it holds, not the first day it does not.
 */
export function isExpired(rule: Scoped, now: string | undefined): boolean {
  if (rule.until === undefined || now === undefined) return false;
  if (Number.isNaN(Date.parse(rule.until)) || Number.isNaN(Date.parse(now))) return false;
  return now.slice(0, 10) > rule.until.slice(0, 10);
}

/**
 * Path containment on the child-index address, boundary-aware.
 *
 * `0/1` contains `0/1/2` and does not contain `0/10`, which a bare `startsWith`
 * gets wrong — and gets wrong silently, in the direction of ignoring more than
 * was asked for.
 */
export function isUnder(path: NodePath, ancestor: NodePath): boolean {
  if (path === ancestor) return true;
  return path.startsWith(`${ancestor}/`);
}

export function appliesToSubject(rule: Scoped, subjectId: string): boolean {
  if (rule.subjects === undefined) return true;
  return rule.subjects.some((pattern) => matchesGlob(subjectId, pattern));
}

/** `*` matches any run of characters, including none. Nothing else is special. */
export function matchesGlob(value: string, pattern: string): boolean {
  if (!pattern.includes('*')) return value === pattern;

  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${escaped}$`).test(value);
}
