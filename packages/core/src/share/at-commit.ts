/**
 * A mainline's record kept at the commit it ran at, beside the latest.
 *
 * The latest answers a checkout at the mainline's tip. A checkout behind it —
 * a release branch, a pull request cut last week, a user who does not track
 * the tip — is measured against its merge base, and the latest is a record of
 * code it does not have: every commit between is charged to it. So each
 * mainline publish also writes the line `at/<commit>/…` (`publishLine`),
 * and a reader asks for its merge base's before the latest.
 *
 * What is kept is bounded, and the publish that writes the next record removes
 * what fell out: {@link KEEP_DAYS} days and at most {@link KEEP_COMMITS}
 * commits per mainline, the window the cache keeps by (ADR-0078). A store whose
 * cell cannot list and remove lines keeps the latest only, because a record
 * nothing removes is a record kept for ever.
 */

import type { KeptAt, ShareLine, ShareMiss } from './line.js';

/** Days a mainline's record is kept at its commit. */
export const KEEP_DAYS = 14;
/** Commits a mainline's record is kept at, the newest. */
export const KEEP_COMMITS = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The line that holds `line`'s record at `commit`. */
export function atCommit(line: ShareLine, commit: string): ShareLine {
  return { kind: line.kind, name: line.name, at: commit };
}

/** The commits a publish kept its record at, and the ones it removed as past the window, or why it could not. */
export type KeptCommits = { readonly kept: readonly string[]; readonly dropped: readonly string[] } | ShareMiss;

/** The commits past {@link KEEP_DAYS} days old at `now`, or beyond the newest {@link KEEP_COMMITS}. */
export function pastWindow(held: readonly KeptAt[], now: number): string[] {
  return [...held]
    .sort((a, b) => b.written - a.written)
    .filter((one, index) => index >= KEEP_COMMITS || now - one.written > KEEP_DAYS * DAY_MS)
    .map((one) => one.commit)
    .sort();
}
