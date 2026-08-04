import type { SQLOutputValue } from 'node:sqlite';
import { profileById, type Digest, type ProfileId } from '@variance-authority/core';
import {
  BANDS,
  type Band,
  type Observation,
  type RunRecord,
  type TokenValue,
} from '@variance-authority/history';

/**
 * The boundary where a stored row becomes a value the rest of the system trusts.
 *
 * Separate from the connection because nothing here holds a database handle: every
 * function takes a row and returns a checked value or throws, which is what makes
 * the strictness below cheap to keep. `backend-sqlite.ts` opens the file,
 * `sqlite-queries.ts` decides which rows to ask for, and this module is the only
 * place that decides what a row *is*.
 */

/**
 * An instant as a comparable number.
 *
 * Refuses rather than defaults. A row whose `at` cannot be parsed would land with
 * a NULL ordering key, sort ahead of or behind everything depending on the query,
 * and turn `12px → 20px` into `20px → 12px` — a confident sentence that is exactly
 * backwards.
 */
export function instant(at: string, what: string): number {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) {
    throw new Error(`${what} carries "${at}", which is not an ISO-8601 instant`);
  }
  return parsed;
}

/**
 * Reading a row back is validation, not a cast.
 *
 * SQLite is typed per value, not per column, and `STRICT` tables only constrain
 * what this build writes. A row written by a future version, or by a person with
 * a SQL prompt, reaches here as whatever it is; casting it would let a number
 * become a component name and a NULL become the string "null" three layers later.
 */
export function text(row: Record<string, SQLOutputValue>, column: string, what: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new Error(`${what} has a \`${column}\` that is not text: ${describe(value)}`);
  }
  return value;
}

function optionalText(
  row: Record<string, SQLOutputValue>,
  column: string,
  what: string,
): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${what} has a \`${column}\` that is neither text nor null: ${describe(value)}`);
  }
  return value;
}

export function number(row: Record<string, SQLOutputValue>, column: string, what: string): number {
  const value = row[column];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what} has a \`${column}\` that is not a number: ${describe(value)}`);
  }
  return value;
}

function band(row: Record<string, SQLOutputValue>, what: string): Band {
  const value = text(row, 'band', what);
  if (!BANDS.includes(value as Band)) {
    throw new Error(`${what} has an unknown band "${value}"`);
  }
  return value as Band;
}

/**
 * Profiles are checked against `core`'s table rather than a list kept here, so a
 * new tier does not become a store that rejects rows the rest of the system
 * considers valid.
 */
function profile(row: Record<string, SQLOutputValue>, what: string): ProfileId {
  const value = text(row, 'profile', what);
  const known: unknown = profileById(value as ProfileId);
  if (known === undefined) throw new Error(`${what} has an unknown profile "${value}"`);
  return value as ProfileId;
}

export function toObservation(row: Record<string, SQLOutputValue>): Observation {
  const what = 'a stored observation';
  const file = optionalText(row, 'file', what);

  return {
    project: text(row, 'project', what),
    subject: text(row, 'subject', what),
    component: text(row, 'component', what),
    band: band(row, what),
    hash: text(row, 'hash', what) as Digest,
    profile: profile(row, what),
    commit: text(row, 'commit', what),
    run: text(row, 'run', what),
    at: text(row, 'at', what),
    accepted: number(row, 'accepted', what) !== 0,
    ...(file !== undefined ? { file } : {}),
  };
}

export function toRunRecord(row: Record<string, SQLOutputValue>): RunRecord {
  const what = 'a stored run';
  return {
    project: text(row, 'project', what),
    run: text(row, 'run', what),
    commit: text(row, 'commit', what),
    profile: profile(row, what),
    at: text(row, 'at', what),
  };
}

export function toTokenValue(row: Record<string, SQLOutputValue>): TokenValue {
  const what = 'a stored token value';
  return {
    project: text(row, 'project', what),
    token: text(row, 'token', what),
    value: text(row, 'value', what),
    commit: text(row, 'commit', what),
    at: text(row, 'at', what),
  };
}

function describe(value: SQLOutputValue | undefined): string {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  return `${typeof value} (${String(value).slice(0, 60)})`;
}
