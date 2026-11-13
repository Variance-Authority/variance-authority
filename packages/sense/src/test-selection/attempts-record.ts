/**
 * How each attempt of a retried case ended: what the case index's fold of
 * them — `stopped`, `duration`, `limit` — loses. One row per attempt of a case
 * its runner reported more than one attempt of, joined to its case by the
 * index's id, as an Eyes journal is. Absent, attempts were not kept; empty, no
 * case was retried. Two rows for one attempt of one case, as two shards or two
 * repeats hand over, are one: the row whose JSON text sorts first by code unit.
 *
 * No selection reads it and no digest a selection compares takes it in; the
 * digest of the whole record file covers it as it covers every section.
 */

import { isVendorPath, parseStackFrames } from '@variance-authority/core/attribute';
import { AMBIENT, caseIds, caseKey, type CaseCoordinate } from './cases.js';
import { orderedByAttempt } from './eyes-record.js';

/** How one attempt of one case ended. */
export interface RecordedAttempt {
  /** The case, by the id the record's case index gives it. */
  readonly case: string;
  /** Which run of the case this is, counted from 1. A retry is attempt 2. */
  readonly attempt: number;
  /**
   * How it ended, in the word of the runner that ran it: its own report of
   * the attempt, never what the case's body did. A limit that stopped an
   * attempt is `timedOut` only from a runner that tells it from a failure.
   */
  readonly ended: string;
  /** How long the attempt ran, in milliseconds; absent, nobody timed it. */
  readonly duration?: number;
  /** What an attempt that did not pass failed with, cut at {@link MESSAGE} characters. */
  readonly message?: string;
  /** The nearest frame of that failure inside the checkout, as `path:line` from its root. */
  readonly frame?: string;
}

/** One attempt as a producer hands it over, before the run has named the case. */
export interface ObservedAttempt {
  readonly attempt: number;
  readonly ended: string;
  readonly duration?: number;
  readonly message?: string;
  /** The failure's stack, for {@link frameIn} to find the checkout's frame in. */
  readonly stack?: string;
}

interface Section {
  readonly version: 1;
  readonly attempts: readonly RecordedAttempt[];
}

/** Enough to name a failure without carrying the diff of two large values. */
const MESSAGE = 500;

/** The section bytes for `attempts`, in case and then attempt order, each attempt once. */
export function encodeRecordedAttempts(attempts: readonly RecordedAttempt[]): Uint8Array {
  const section: Section = { version: 1, attempts: ordered(attempts) };
  return Buffer.from(`${JSON.stringify(section)}\n`);
}

/** What an attempts section holds, refusing a section that is not one. */
export function decodeRecordedAttempts(bytes: Uint8Array): readonly RecordedAttempt[] {
  let section: unknown;
  try {
    section = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('the record\'s attempts section is not JSON');
  }
  const candidate = section as Partial<Section> | null;
  if (typeof candidate !== 'object' || candidate === null || candidate.version !== 1 || !Array.isArray(candidate.attempts)) {
    throw new Error('the record\'s attempts section is not version 1');
  }
  for (const row of candidate.attempts) checked(row);
  return ordered(candidate.attempts);
}

/**
 * What an attempts section holds, or `undefined` when attempts were not kept:
 * the record has no section, or this build cannot read the one it has. An
 * empty answer is a different one — attempts were kept, and no case was
 * retried.
 */
export function readableAttempts(bytes: Uint8Array | undefined): readonly RecordedAttempt[] | undefined {
  if (bytes === undefined) return undefined;
  try {
    return decodeRecordedAttempts(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The attempts section once a run's attempts are laid over the record's.
 *
 * A case in `ran` has its attempts replaced by the run's, and by none when the
 * run retried it no more; a case `cases` no longer holds loses its own; every
 * other keeps what it had. A fresh attempt whose case is not in `cases` is
 * refused. `undefined` when neither the record nor the run kept attempts.
 */
export function layAttempts(
  previous: Uint8Array | undefined,
  fresh: readonly RecordedAttempt[] | undefined,
  cases: () => readonly string[],
  ran: readonly string[],
): Uint8Array | undefined {
  const prior = readableAttempts(previous);
  if (prior === undefined && fresh === undefined) return undefined;
  const held = new Set(cases());
  for (const row of fresh ?? []) {
    if (!held.has(row.case)) throw new Error(`an attempt names a case the run did not record: ${row.case}`);
  }
  const replaced = new Set(ran);
  return encodeRecordedAttempts([
    ...(prior?.filter((row) => held.has(row.case) && !replaced.has(row.case)) ?? []),
    ...(fresh?.filter((row) => replaced.has(row.case)) ?? []),
  ]);
}

/**
 * The rows of every case with an attempt past its first, in case and attempt
 * order. An attempt that never settled has no row, so a case whose only row is
 * attempt 2 is kept: its first attempt ended without a word.
 */
export function retriedAttempts(attempts: readonly RecordedAttempt[]): readonly RecordedAttempt[] {
  const most = new Map<string, number>();
  for (const row of attempts) most.set(row.case, Math.max(most.get(row.case) ?? 0, row.attempt));
  return ordered(attempts.filter((row) => most.get(row.case)! > 1));
}

/**
 * The first frame of `stack` inside the checkout at `root` that is neither a
 * dependency's nor the seam's own, as `path:line` from the root — the line a
 * reader opens. `undefined` when the stack names no such frame.
 */
export function frameIn(stack: string | undefined, root: string | undefined): string | undefined {
  if (stack === undefined || root === undefined) return undefined;
  const prefix = `${root.replaceAll('\\', '/').replace(/\/$/u, '')}/`;
  for (const frame of parseStackFrames(stack)) {
    const path = frame.url.replaceAll('\\', '/').replace(/^file:\/\/(?=\/)/u, '');
    const inside = path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
    // The seam's own wrapper around a case is written under `.variance-authority/`: nobody opens it.
    if (inside === undefined || isVendorPath(`/${inside}`) || inside.split('/').includes('.variance-authority')) continue;
    return `${inside}:${frame.line}`;
  }
  return undefined;
}

/** One attempt as the record keeps it: its message without colour and cut, its stack as the checkout's frame. */
export function recordedAttempt(caseId: string, observed: ObservedAttempt, root: string | undefined): RecordedAttempt {
  const { attempt, ended, duration } = observed;
  // A runner colours an assertion's message for a terminal.
  // eslint-disable-next-line no-control-regex
  const message = observed.message?.replace(/\u001b\[[0-9;]*m/gu, '').trimEnd().slice(0, MESSAGE);
  const frame = frameIn(observed.stack, root);
  return {
    case: caseId,
    attempt,
    ended,
    ...(duration === undefined ? {} : { duration }),
    ...(message === undefined || message === '' ? {} : { message }),
    ...(frame === undefined ? {} : { frame }),
  };
}

/**
 * The attempts of a run's cases as the record keeps them, each joined to its
 * case by the id the run's index gives it, and only for a case that ran more
 * than once.
 *
 * A case whose `attempts` is present was observed attempt by attempt.
 * `undefined` when no case was: the run kept no attempts.
 */
export function attemptsOfCases(
  cases: readonly (CaseCoordinate & { readonly attempts?: readonly ObservedAttempt[] })[],
  root: string | undefined,
): readonly RecordedAttempt[] | undefined {
  const named = cases.filter((observed) => observed.name !== AMBIENT && observed.id !== AMBIENT);
  const kept = named.filter((observed) => observed.attempts !== undefined);
  if (kept.length === 0) return undefined;
  const ids = caseIds(named);
  return retriedAttempts(kept.flatMap((observed) =>
    observed.attempts!.map((attempt) => recordedAttempt(ids.get(caseKey(observed))!, attempt, root))));
}

function ordered(rows: readonly RecordedAttempt[]): readonly RecordedAttempt[] {
  return orderedByAttempt(rows, (row) => JSON.stringify(row));
}

function checked(row: unknown): void {
  const candidate = row as Partial<RecordedAttempt> | null;
  if (typeof candidate !== 'object' || candidate === null || typeof candidate.case !== 'string' || candidate.case === '' ||
    !Number.isInteger(candidate.attempt) || candidate.attempt! < 1 || typeof candidate.ended !== 'string') {
    throw new Error('the record\'s attempts section holds a row that names no case, attempt and ending');
  }
}
