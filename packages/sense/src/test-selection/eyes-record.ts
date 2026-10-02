/**
 * The Eyes journals a record carries, beside the cases they belong to.
 *
 * A journal is what a case addressed while it ran — its selectors, Locators,
 * events and commits — as `@variance-authority/eyes` closes it. The record
 * keeps one per case and attempt, joined to the case by the id the case index
 * gives it, and nothing else names the case: no title, no runner id, no file.
 * A journal whose case the index does not hold is a dangling reference, and it
 * is refused rather than kept, so a reader never has to guess what it meant.
 *
 * What a journal holds is Eyes' to read. Sense lays, carries and refuses rows
 * by case and attempt, and treats the rest of a row as the bytes it was.
 *
 * The section is written only by a run whose cases handed journals over: a run
 * that did not compose Eyes keeps none, and the record's section is absent, not
 * empty.
 */

import { caseSectionsAt } from './case-record.js';
import { AMBIENT, caseIds, caseKey, type CaseCoordinate } from './cases.js';
import { openSetExecutionIndex } from './execution-set-format.js';
import { codeUnitOrder } from './instrumented-modules.js';

/** One case's journal for one attempt. */
export interface RecordedEyes {
  /** The case, by the id the record's case index gives it. */
  readonly case: string;
  /** Which run of the case this is, counted from 1. A retry is attempt 2. */
  readonly attempt: number;
  /** The journal as Eyes closed it; the record does not read it. */
  readonly journal: Readonly<Record<string, unknown>>;
}

interface Section {
  readonly version: 1;
  readonly journals: readonly RecordedEyes[];
}

/**
 * The section bytes for `rows`, in case and attempt order.
 *
 * Refuses a second journal for a case and attempt that differs from the first:
 * two shards that ran one case are one journal said twice, and two journals
 * that disagree are a fold that lost track of which is which.
 */
export function encodeRecordedEyes(rows: readonly RecordedEyes[]): Uint8Array {
  const section: Section = { version: 1, journals: ordered(rows) };
  return Buffer.from(`${JSON.stringify(section)}\n`);
}

/** The rows an Eyes section holds, refusing a section that is not one. */
export function decodeRecordedEyes(bytes: Uint8Array): readonly RecordedEyes[] {
  let section: unknown;
  try {
    section = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('the record\'s eyes section is not JSON');
  }
  if (typeof section !== 'object' || section === null || (section as Section).version !== 1 ||
    !Array.isArray((section as Section).journals)) {
    throw new Error('the record\'s eyes section is not version 1');
  }
  for (const row of (section as Section).journals) checked(row);
  return ordered((section as Section).journals);
}

/**
 * The Eyes section once a run's journals are laid over the record's.
 *
 * `merged` is the case index the run leaves in the record and `ran` the cases
 * the run recorded. A case that ran has its journals replaced by the run's,
 * every attempt of them, and has none when the run kept none for it; a case
 * the index no longer holds loses its journals with it. Every other case keeps
 * the journals it had.
 *
 * A fresh journal whose case is not in `merged` is refused: the run's own fold
 * named the cases, and a journal it cannot join is a producer that named its
 * case some other way. `undefined` when no journal is left.
 */
export function layEyes(
  previous: Uint8Array | undefined,
  fresh: readonly RecordedEyes[],
  merged: Uint8Array,
  ran: readonly string[],
): Uint8Array | undefined {
  if (previous === undefined && fresh.length === 0) return undefined;
  const index = openSetExecutionIndex(merged);
  if (index === undefined) throw new Error('a case fold wrote an index it cannot open');
  const held = new Set(index.tests.map((test) => test.id));
  for (const row of fresh) {
    if (!held.has(row.case)) throw new Error(`an Eyes journal names a case the run did not record: ${row.case}`);
  }
  const replaced = new Set(ran);
  const kept = previous === undefined
    ? []
    : decodeRecordedEyes(previous).filter((row) => held.has(row.case) && !replaced.has(row.case));
  const rows = [...kept, ...fresh];
  return rows.length === 0 ? undefined : encodeRecordedEyes(rows);
}

/** The Eyes journals the record at `coverageFile` carries; `undefined` when it kept none. */
export function recordedEyesAt(coverageFile: string): readonly RecordedEyes[] | undefined {
  const eyes = caseSectionsAt(coverageFile).eyes;
  return eyes === undefined ? undefined : decodeRecordedEyes(eyes);
}

/** One attempt's journal as a driver hands it over, before the run has named the case. */
export interface ObservedEyes {
  /** Which run of the case this is, counted from 1. */
  readonly attempt: number;
  readonly journal: Readonly<Record<string, unknown>>;
}

function ordered(rows: readonly RecordedEyes[]): readonly RecordedEyes[] {
  const byKey = new Map<string, RecordedEyes>();
  for (const row of rows) {
    const key = `${row.case}\0${row.attempt}`;
    const held = byKey.get(key);
    if (held === undefined) byKey.set(key, row);
    else if (JSON.stringify(held) !== JSON.stringify(row)) {
      throw new Error(`two different Eyes journals for ${row.case}, attempt ${row.attempt}`);
    }
  }
  return [...byKey.values()].sort((left, right) => codeUnitOrder(left.case, right.case) || left.attempt - right.attempt);
}

function checked(row: unknown): void {
  const candidate = row as Partial<RecordedEyes> | null;
  if (typeof candidate !== 'object' || candidate === null || typeof candidate.case !== 'string' || candidate.case === '' ||
    !Number.isInteger(candidate.attempt) || candidate.attempt! < 1 ||
    typeof candidate.journal !== 'object' || candidate.journal === null) {
    throw new Error('the record\'s eyes section holds a row that names no case and attempt');
  }
}

/**
 * The Eyes journals of a run's cases as the record keeps them, each joined to
 * its case by the id the run's index gives it — the same numbering, so a case
 * that shares its name with another is never given the other's journal.
 */
export function eyesOfCases(
  cases: readonly (CaseCoordinate & { readonly eyes?: readonly ObservedEyes[] })[],
): readonly RecordedEyes[] {
  const named = cases.filter((observed) => observed.name !== AMBIENT && observed.id !== AMBIENT);
  const ids = caseIds(named);
  return named.flatMap((observed) =>
    (observed.eyes ?? []).map(({ attempt, journal }) => ({ case: ids.get(caseKey(observed))!, attempt, journal })));
}
