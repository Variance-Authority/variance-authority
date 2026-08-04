import { profileById, type Digest, type ProfileId } from '@variance-authority/core';
import {
  BANDS,
  type Band,
  type Observation,
  type RunRecord,
  type TokenValue,
} from '@variance-authority/history';
import { BadRequest } from './http-errors.js';

/**
 * The door the append-only store is behind.
 *
 * Every function here reads untrusted JSON and returns a value the store may keep
 * forever, or throws. It is a separate module because that is a different job from
 * serving a socket: nothing here touches a request, a response or a status code,
 * so the whole of it is exercised by handing it a string — and the strictness it
 * carries is worth being able to test that directly.
 *
 * Nothing is repaired on the way in. A row with an unparseable timestamp, an
 * unknown band, or a profile `core` has never heard of is refused rather than
 * stored and discovered later, because a bad row that is already in an
 * append-only store cannot be taken out again.
 */

export interface ParsedRecordRequest {
  readonly run: RunRecord;
  readonly observations: readonly Observation[];
  readonly tokens: readonly TokenValue[];
}

/**
 * Validate a write completely before any of it is appended.
 *
 * The store is append-only, so this is the last moment anything can be refused. A
 * row with an unknown band or an unparseable instant that gets in stays in, and
 * every later query over that window either throws or silently misorders — so the
 * strictness here is not politeness about input, it is the only place the
 * invariant can still be enforced.
 */
export function parseRecordRequest(body: string): ParsedRecordRequest {
  if (body.trim() === '') {
    throw new BadRequest(
      'the write carried no body; a run with no rows is still recorded, but it has to say which ' +
        'run it was',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new BadRequest(
      `the request body is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const source = asRecord(parsed, 'the request body');

  return {
    run: asRunRecord(source['run']),
    observations: asArray(source['observations'], '`observations`').map((row, index) =>
      asObservation(row, `observations[${index}]`),
    ),
    tokens: asArray(source['tokens'], '`tokens`').map((row, index) =>
      asTokenValue(row, `tokens[${index}]`),
    ),
  };
}

function asRecord(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequest(`${what} must be an object; received ${describe(value)}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function asArray(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new BadRequest(`${what} must be an array; received ${describe(value)}`);
  }
  return value as readonly unknown[];
}

function text(source: Readonly<Record<string, unknown>>, key: string, what: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value === '') {
    throw new BadRequest(`${what}.${key} must be a non-empty string; received ${describe(value)}`);
  }
  return value;
}

function instant(source: Readonly<Record<string, unknown>>, key: string, what: string): string {
  const value = text(source, key, what);
  if (Number.isNaN(Date.parse(value))) {
    throw new BadRequest(
      `${what}.${key} must be an ISO-8601 instant; received "${value}". A row whose time cannot ` +
        'be parsed orders a journey wrongly, and a journey read backwards is a confident sentence ' +
        'that is exactly reversed',
    );
  }
  return value;
}

function flag(source: Readonly<Record<string, unknown>>, key: string, what: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    throw new BadRequest(`${what}.${key} must be a boolean; received ${describe(value)}`);
  }
  return value;
}

export function asBand(value: unknown, what: string): Band {
  if (typeof value !== 'string' || !BANDS.includes(value as Band)) {
    throw new BadRequest(`${what} must be one of ${BANDS.join(', ')}; received ${describe(value)}`);
  }
  return value as Band;
}

/**
 * Profiles are checked against `core`'s own table, so a tier added there is
 * accepted here without this file being edited — and a typo is still refused
 * rather than stored as a profile no query will ever match.
 */
function asProfile(value: unknown, what: string): ProfileId {
  const known: unknown = typeof value === 'string' ? profileById(value as ProfileId) : undefined;
  if (known === undefined) {
    throw new BadRequest(`${what}.profile is not a known observation profile: ${describe(value)}`);
  }
  return value as ProfileId;
}

function asRunRecord(value: unknown): RunRecord {
  const what = '`run`';
  const source = asRecord(value, what);

  return {
    project: text(source, 'project', what),
    run: text(source, 'run', what),
    commit: text(source, 'commit', what),
    profile: asProfile(source['profile'], what),
    at: instant(source, 'at', what),
  };
}

function asObservation(value: unknown, what: string): Observation {
  const source = asRecord(value, what);
  const file = source['file'];

  if (file !== undefined && file !== null && typeof file !== 'string') {
    throw new BadRequest(`${what}.file must be a string when present; received ${describe(file)}`);
  }

  return {
    project: text(source, 'project', what),
    subject: text(source, 'subject', what),
    component: text(source, 'component', what),
    band: asBand(source['band'], `${what}.band`),
    hash: text(source, 'hash', what) as Digest,
    profile: asProfile(source['profile'], what),
    commit: text(source, 'commit', what),
    run: text(source, 'run', what),
    at: instant(source, 'at', what),
    accepted: flag(source, 'accepted', what),
    ...(typeof file === 'string' && file !== '' ? { file } : {}),
  };
}

function asTokenValue(value: unknown, what: string): TokenValue {
  const source = asRecord(value, what);

  return {
    project: text(source, 'project', what),
    token: text(source, 'token', what),
    // Not `text`: an empty resolved value is a legitimate reading — a token that
    // resolves to nothing is a change worth recording, and refusing it here would
    // put a hole in a journey that nothing explains.
    value: string(source, 'value', what),
    commit: text(source, 'commit', what),
    at: instant(source, 'at', what),
  };
}

function string(source: Readonly<Record<string, unknown>>, key: string, what: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new BadRequest(`${what}.${key} must be a string; received ${describe(value)}`);
  }
  return value;
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `${typeof value} (${JSON.stringify(value)?.slice(0, 80) ?? ''})`;
}
