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
 * Beside the journals, the section names every case whose run opened one for
 * it. A case that opened a journal and handed none over — it never reached its
 * teardown — is told apart from a case whose run did not compose Eyes at all.
 *
 * What a journal holds is Eyes' to read. Sense lays, carries and refuses rows
 * by case and attempt, and treats the rest of a row as the bytes it was.
 *
 * The section is written only by a run whose cases opened journals: a run that
 * did not compose Eyes keeps none, and the record's section is absent, not
 * empty.
 */

import { AMBIENT, caseIds, caseKey, type CaseCoordinate } from './cases.js';
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

/** What a record, or one run, holds of Eyes. */
export interface EyesSection {
  /** Every case whose run opened a journal for it, by id; a case with a journal is among them. */
  readonly watched: readonly string[];
  readonly journals: readonly RecordedEyes[];
}

interface Section extends EyesSection {
  readonly version: 1;
}

/**
 * The section bytes for `eyes`, its cases in code-unit order and its journals
 * in case and attempt order.
 *
 * Two shards that ran one case hand one journal twice, and it is kept once.
 * Two journals that differ for one case and attempt were both closed by a run
 * of that attempt; the one that sorts first as JSON is kept, so the record a
 * fold writes does not depend on the order its shards were named in, and the
 * run it lands is never failed for it.
 */
export function encodeRecordedEyes(eyes: EyesSection): Uint8Array {
  const journals = ordered(eyes.journals);
  const watched = [...new Set([...eyes.watched, ...journals.map((row) => row.case)])].sort(codeUnitOrder);
  const section: Section = { version: 1, watched, journals };
  return Buffer.from(`${JSON.stringify(section)}\n`);
}

/** What an Eyes section holds, refusing a section that is not one. */
export function decodeRecordedEyes(bytes: Uint8Array): EyesSection {
  let section: unknown;
  try {
    section = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('the record\'s eyes section is not JSON');
  }
  const candidate = section as Partial<Section> | null;
  if (typeof candidate !== 'object' || candidate === null || candidate.version !== 1 ||
    !Array.isArray(candidate.journals) || !Array.isArray(candidate.watched) ||
    candidate.watched.some((id) => typeof id !== 'string')) {
    throw new Error('the record\'s eyes section is not version 1');
  }
  for (const row of candidate.journals) checked(row);
  return { watched: candidate.watched, journals: ordered(candidate.journals) };
}

/**
 * What an Eyes section holds, or `undefined` when this build cannot read it:
 * a section written by a newer build, or bytes that are not one. A record
 * that crosses to this build, or a run that lays over it, drops it there
 * rather than fail every later reading of the record.
 */
export function readableEyes(bytes: Uint8Array | undefined): EyesSection | undefined {
  if (bytes === undefined) return undefined;
  try {
    return decodeRecordedEyes(bytes);
  } catch {
    return undefined;
  }
}

/**
 * The Eyes section once a run's Eyes are laid over the record's.
 *
 * `cases` are the ids of the index the run leaves in the record, and `ran` the
 * cases the run recorded. A case that ran has its journals, and whether it was
 * watched, replaced by the run's: every attempt, and none when the run opened
 * none for it. `fresh` is `undefined` for a run that did not compose Eyes. A
 * case the index no longer holds loses its journals with it. Every other case
 * keeps what it had. A section this build cannot read is laid over as none.
 *
 * A fresh journal whose case is not in `cases` is refused: the run's own fold
 * named the cases, and a journal it cannot join is a producer that named its
 * case some other way. `undefined` when no case is left watched.
 */
export function layEyes(
  previous: Uint8Array | undefined,
  fresh: EyesSection | undefined,
  cases: readonly string[],
  ran: readonly string[],
): Uint8Array | undefined {
  const prior = readableEyes(previous);
  if (prior === undefined && fresh === undefined) return undefined;
  const held = new Set(cases);
  for (const row of fresh?.journals ?? []) {
    if (!held.has(row.case)) throw new Error(`an Eyes journal names a case the run did not record: ${row.case}`);
  }
  const replaced = new Set(ran);
  const kept = (id: string): boolean => held.has(id) && !replaced.has(id);
  const watched = [...(prior?.watched.filter(kept) ?? []), ...(fresh?.watched.filter((id) => held.has(id)) ?? [])];
  const journals = [...(prior?.journals.filter((row) => kept(row.case)) ?? []), ...(fresh?.journals ?? [])];
  return watched.length === 0 && journals.length === 0 ? undefined : encodeRecordedEyes({ watched, journals });
}

/** One attempt's journal as a driver hands it over, before the run has named the case. */
export interface ObservedEyes {
  /** Which run of the case this is, counted from 1. */
  readonly attempt: number;
  readonly journal: Readonly<Record<string, unknown>>;
}

function ordered(rows: readonly RecordedEyes[]): readonly RecordedEyes[] {
  const byKey = new Map<string, { row: RecordedEyes; text: string }>();
  for (const row of rows) {
    const key = `${row.case}\0${row.attempt}`;
    const text = JSON.stringify(row.journal);
    const held = byKey.get(key);
    if (held === undefined || codeUnitOrder(text, held.text) < 0) byKey.set(key, { row, text });
  }
  return [...byKey.values()]
    .map(({ row }) => row)
    .sort((left, right) => codeUnitOrder(left.case, right.case) || left.attempt - right.attempt);
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
 * The Eyes of a run's cases as the record keeps them, each joined to its case
 * by the id the run's index gives it — the same numbering, so a case that
 * shares its name with another is never given the other's journal.
 *
 * A case whose `eyes` is present opened a journal, whether or not it handed
 * one over. `undefined` when no case did: the run did not compose Eyes.
 */
export function eyesOfCases(
  cases: readonly (CaseCoordinate & { readonly eyes?: readonly ObservedEyes[] })[],
): EyesSection | undefined {
  const named = cases.filter((observed) => observed.name !== AMBIENT && observed.id !== AMBIENT);
  const looked = named.filter((observed) => observed.eyes !== undefined);
  if (looked.length === 0) return undefined;
  const ids = caseIds(named);
  return {
    watched: looked.map((observed) => ids.get(caseKey(observed))!),
    journals: looked.flatMap((observed) =>
      observed.eyes!.map(({ attempt, journal }) => ({ case: ids.get(caseKey(observed))!, attempt, journal }))),
  };
}
