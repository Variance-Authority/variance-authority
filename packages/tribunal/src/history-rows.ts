import { profileById, type Digest, type ProfileId } from '@variance-authority/core';
import {
  BANDS,
  type Band,
  type Observation,
  type RunRecord,
  type TokenValue,
} from '@variance-authority/history';

/**
 * Reading a row back is validation, not a cast.
 *
 * SQLite is typed per value rather than per column, and `STRICT` only constrains
 * what this build writes. A row written by a future version, or by a person at a
 * `wrangler d1 execute` prompt, arrives here as whatever it is; casting it would
 * let a number become a component name and a NULL become the string "null" three
 * layers later.
 *
 * That argument is the whole of this file, and it is why it is a file: every
 * reader below is one refusal, and the same handful of them is used by the append
 * path, the filters, the slices and the reach query alike. `instant` sits with
 * them because it is the same refusal applied to a bound rather than to a column.
 * Nothing here knows any SQL, and [`history.ts`](./history.ts) knows nothing
 * about what a stored value is allowed to be.
 */

export type Row = Record<string, unknown>;

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

export function text(row: Row, column: string, what: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new Error(`${what} has a \`${column}\` that is not text: ${describe(value)}`);
  }
  return value;
}

function optionalText(row: Row, column: string, what: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${what} has a \`${column}\` that is neither text nor null: ${describe(value)}`);
  }
  return value;
}

export function number(row: Row, column: string, what: string): number {
  const value = row[column];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what} has a \`${column}\` that is not a number: ${describe(value)}`);
  }
  return value;
}

function band(row: Row, what: string): Band {
  const value = text(row, 'band', what);
  if (!BANDS.includes(value as Band)) throw new Error(`${what} has an unknown band "${value}"`);
  return value as Band;
}

/** Checked against `core`'s table, so a new tier does not become a rejected row. */
function profile(row: Row, what: string): ProfileId {
  const value = text(row, 'profile', what);
  const known: unknown = profileById(value as ProfileId);
  if (known === undefined) throw new Error(`${what} has an unknown profile "${value}"`);
  return value as ProfileId;
}

export function toObservation(row: Row): Observation {
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

export function toRunRecord(row: Row): RunRecord {
  const what = 'a stored run';
  return {
    project: text(row, 'project', what),
    run: text(row, 'run', what),
    commit: text(row, 'commit', what),
    profile: profile(row, what),
    at: text(row, 'at', what),
  };
}

export function toTokenValue(row: Row): TokenValue {
  const what = 'a stored token value';
  return {
    project: text(row, 'project', what),
    token: text(row, 'token', what),
    value: text(row, 'value', what),
    commit: text(row, 'commit', what),
    at: text(row, 'at', what),
  };
}

function describe(value: unknown): string {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  return `${typeof value} (${String(value).slice(0, 60)})`;
}
