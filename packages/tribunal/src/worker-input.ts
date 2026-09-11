import { BANDS as FREQUENCY_BANDS } from '@variance-authority/core/compare';
import { profileById, type Digest, type ProfileId } from '@variance-authority/core/format';
import {
  BANDS,
  MAX_CURRENT_SUBJECTS,
  type Approval,
  type Band,
  type FrequencyBand,
  type Instability,
  type Observation,
  type RunRecord,
  type TokenValue,
  type Window,
} from '@variance-authority/history';
import { identityFrom } from '@variance-authority/raster';
import type { RunReport } from '@variance-authority/report';
import type { BuildIngest, Decision, SubjectImages } from './review-types.js';
import {
  BadRequest,
  array,
  asRecordBody,
  describe,
  flag,
  instant,
  optional,
  record,
  string,
} from './worker-http.js';

/**
 * Every request body and query string this deployment accepts, checked before any
 * of it reaches a store.
 *
 * One file because these share a deadline rather than a subject. The baseline
 * routes, the history routes and the build ingest all write to something that
 * does not forget, and each function below is the last moment its route can still
 * refuse — the history record is append-only, a promoted baseline is what the
 * next run compares against, and a build row outlives the request that made it.
 * What each one checks differs, and the argument for it sits on the function.
 *
 * Reading a *response* is a different job with a different consequence and is not
 * here: `identityFrom` and `rasterFrom` come from `@variance-authority/raster`
 * because a misread response becomes a verdict, while everything below becomes a
 * 4xx nobody mistakes for an answer.
 */

export function asKey(value: unknown): { readonly subject: string; readonly label?: string } {
  const source = record(value, '`key`');
  const label = source['label'];
  if (label !== undefined && typeof label !== 'string') {
    throw new BadRequest('`key.label` must be a string when present');
  }
  return {
    subject: string(source, 'subject', '`key`'),
    ...(typeof label === 'string' ? { label } : {}),
  };
}

export function asIdentity(value: unknown): ReturnType<typeof identityFrom> & object {
  const identity = identityFrom(value);
  if (identity === null) {
    // Never defaulted, and never partially rebuilt. An identity missing a field
    // is a different machine from the one that wrote the baseline, and inventing
    // the field would make a wrong-machine comparison look comparable.
    throw new BadRequest(
      '`identity` is not a renderer identity. Every field is required, because the identity is ' +
        'the partition that decides whether two images may be compared at all',
    );
  }
  return identity;
}

export function asDecision(value: unknown): Decision {
  if (value !== 'approved' && value !== 'rejected') {
    throw new BadRequest(`\`decision\` must be "approved" or "rejected"; received ${describe(value)}`);
  }
  return value;
}

/**
 * A build, checked before any of it is stored.
 *
 * The report itself is handed to `review.ingest` as-is rather than rebuilt field
 * by field, and that is a deliberate asymmetry with the baseline routes. A
 * misread *response* becomes a verdict; a misread *request* becomes a 4xx nobody
 * mistakes for an answer. What is checked here is what the store would otherwise
 * crash on or silently mis-record — the version, and the shape of the wrapper.
 */
export async function asBuildIngest(request: Request): Promise<BuildIngest> {
  const body = await asRecordBody(request);
  const report = record(body['report'], '`report`');

  if (report['runVersion'] !== 1) {
    throw new BadRequest(
      `\`report.runVersion\` must be 1; received ${describe(report['runVersion'])}. A report from ` +
        'a writer this deployment does not understand would be partly stored and wholly believed',
    );
  }
  if (!Array.isArray(report['observations'])) {
    throw new BadRequest('`report.observations` must be an array');
  }

  const branch = body['branch'];
  const images = body['images'];

  return {
    build: string(body, 'build', 'the build'),
    commit: string(body, 'commit', 'the build'),
    report: report as unknown as RunReport,
    ...(typeof branch === 'string' && branch !== '' ? { branch } : {}),
    ...(images === undefined || images === null
      ? {}
      : { images: record(images, '`images`') as Readonly<Record<string, SubjectImages>> }),
  };
}

/**
 * The window, validated before it can quietly select nothing.
 *
 * An unparseable `since` would reach the query as `NaN`, bind as NULL, match no
 * row, and answer a churn of zero over zero runs — indistinguishable from a
 * component that has never changed. A limit of zero is refused for the same
 * reason: it asks for an answer computed over nothing, dressed as an answer.
 */
export function windowOf(url: URL): Window {
  const since = optional(url, 'since');
  const until = optional(url, 'until');
  const limit = optional(url, 'limit');

  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    throw new BadRequest(`\`since\` must be an ISO-8601 instant; received "${since}"`);
  }
  if (until !== undefined && Number.isNaN(Date.parse(until))) {
    throw new BadRequest(`\`until\` must be an ISO-8601 instant; received "${until}"`);
  }

  let parsedLimit: number | undefined;
  if (limit !== undefined) {
    parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      throw new BadRequest(
        `\`limit\` must be a whole number of at least 1; received "${limit}". A limit of 0 asks ` +
          'for a drift answer computed over no rows, which reads as stability',
      );
    }
  }

  return {
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
  };
}

/**
 * A write, validated completely before any of it is appended.
 *
 * The history store is append-only, so this is the last moment anything can be
 * refused. A row with an unknown band or an unparseable instant that gets in
 * stays in, and every later query over that window either throws or silently
 * misorders — so the strictness here is not politeness about input, it is the
 * only place the invariant can still be enforced.
 */
export async function asRecordRequest(request: Request): Promise<{
  readonly run: RunRecord;
  readonly observations: readonly Observation[];
  readonly tokens: readonly TokenValue[];
  readonly instabilities: readonly Instability[];
}> {
  const body = await asRecordBody(request);

  return {
    run: asRunRecord(body['run']),
    observations: array(body['observations'], '`observations`').map((row, index) =>
      asObservation(row, `observations[${index}]`),
    ),
    tokens: array(body['tokens'], '`tokens`').map((row, index) =>
      asTokenValue(row, `tokens[${index}]`),
    ),
    // Absent is an empty list here and nowhere else in this file, because the
    // claim it makes is carried by a different field: `run.swept` says whether
    // anything examined every subject, so "no instabilities" from a caller that
    // never looked cannot be read as "nothing read differently".
    instabilities: array(body['instabilities'] ?? [], '`instabilities`').map((row, index) =>
      asInstability(row, `instabilities[${index}]`),
    ),
  };
}

/**
 * An acceptance, and who made it when the surface that recorded it knows.
 *
 * The route this parses is how churn learns that anything shipped. Every
 * observation is written unapproved — a run has not been reviewed at the moment
 * it writes — so a deployment that could not take approvals answers *this
 * component has never changed* about a component that changed forty times.
 */
export async function asApprovals(request: Request): Promise<readonly Approval[]> {
  const body = await asRecordBody(request);

  return array(body['approvals'], '`approvals`').map((row, index) => {
    const what = `approvals[${index}]`;
    const source = record(row, what);
    const by = source['by'];

    if (by !== undefined && by !== null && (typeof by !== 'string' || by === '')) {
      throw new BadRequest(
        `${what}.by must be a non-empty string when present; received ${describe(by)}`,
      );
    }

    return {
      project: string(source, 'project', what),
      subject: string(source, 'subject', what),
      run: string(source, 'run', what),
      at: instant(source, 'at', what),
      ...(typeof by === 'string' ? { by } : {}),
    };
  });
}

/**
 * The subject list a run asks about before it writes.
 *
 * The only validation here that refuses a request for being *large* rather than
 * malformed, and the reason is that the answer cannot be trimmed: a `previous`
 * set with a hole in it is a change that did not happen, appended to a store that
 * does not forget. So a caller naming more than one request may carry is told the
 * cap rather than answered with the first {@link MAX_CURRENT_SUBJECTS} and left
 * looking successful.
 */
export async function asCurrentRequest(request: Request): Promise<readonly string[]> {
  const body = await asRecordBody(request);

  const subjects = array(body['subjects'], '`subjects`').map((value, index) => {
    if (typeof value !== 'string' || value === '') {
      throw new BadRequest(
        `subjects[${index}] must be a non-empty string; received ${describe(value)}`,
      );
    }
    return value;
  });

  const distinct = new Set(subjects).size;
  if (distinct > MAX_CURRENT_SUBJECTS) {
    throw new BadRequest(
      `this request names ${distinct} subjects and one \`current\` request may name ` +
        `${MAX_CURRENT_SUBJECTS}. The answer is not trimmed to fit — a missing previous row is ` +
        'indistinguishable from a hash that was never recorded, so the run would append a change ' +
        'that did not happen — so the request is refused and the caller splits its list',
    );
  }

  return subjects;
}

export function asBand(value: unknown, what: string): Band {
  if (typeof value !== 'string' || !BANDS.includes(value as Band)) {
    throw new BadRequest(`${what} must be one of ${BANDS.join(', ')}; received ${describe(value)}`);
  }
  return value as Band;
}

/** Checked against `core`'s own table, so a tier added there needs no edit here. */
function asProfile(value: unknown, what: string): ProfileId {
  const known: unknown = typeof value === 'string' ? profileById(value as ProfileId) : undefined;
  if (known === undefined) {
    throw new BadRequest(`${what}.profile is not a known observation profile: ${describe(value)}`);
  }
  return value as ProfileId;
}

function asRunRecord(value: unknown): RunRecord {
  const what = '`run`';
  const source = record(value, what);
  const swept = source['swept'];

  if (swept !== undefined && swept !== null && typeof swept !== 'boolean') {
    throw new BadRequest(`${what}.swept must be a boolean when present; received ${describe(swept)}`);
  }

  return {
    project: string(source, 'project', what),
    run: string(source, 'run', what),
    commit: string(source, 'commit', what),
    profile: asProfile(source['profile'], what),
    at: instant(source, 'at', what),
    // Absent stays absent through the whole path: a run that never said what it
    // examined must not be stored as one that examined nothing, because that
    // number becomes the denominator of a flake rate.
    ...(typeof swept === 'boolean' ? { swept } : {}),
  };
}

/**
 * One occurrence of a subject failing to read the same way twice.
 *
 * `component` and `band` are optional and their absence is meaningful: a
 * collector that supplied documents without snapshots proved the instability and
 * gave nobody the means to name it. An empty string is refused rather than
 * stored, because it would come back as a component named "".
 */
function asInstability(value: unknown, what: string): Instability {
  const source = record(value, what);
  const component = source['component'];
  const band = source['band'];
  const absorbedBy = source['absorbedBy'];

  for (const [key, held] of [
    ['component', component],
    ['absorbedBy', absorbedBy],
  ] as const) {
    if (held !== undefined && held !== null && (typeof held !== 'string' || held === '')) {
      throw new BadRequest(
        `${what}.${key} must be a non-empty string when present; received ${describe(held)}`,
      );
    }
  }

  return {
    project: string(source, 'project', what),
    subject: string(source, 'subject', what),
    ...(typeof component === 'string' ? { component } : {}),
    ...(band === undefined || band === null ? {} : { band: asFrequencyBand(band, `${what}.band`) }),
    profile: asProfile(source['profile'], what),
    commit: string(source, 'commit', what),
    run: string(source, 'run', what),
    at: instant(source, 'at', what),
    ...(typeof absorbedBy === 'string' ? { absorbedBy } : {}),
  };
}

/**
 * A frequency band, checked against `core`'s list rather than this package's.
 *
 * The two `Band` types classify different things — one names which part of a
 * component was hashed, the other how often that kind of thing changes — and an
 * instability is reported in the second, because that is what a fix is aimed at.
 */
function asFrequencyBand(value: unknown, what: string): FrequencyBand {
  if (typeof value !== 'string' || !FREQUENCY_BANDS.includes(value as FrequencyBand)) {
    throw new BadRequest(
      `${what} must be one of ${FREQUENCY_BANDS.join(', ')}; received ${describe(value)}`,
    );
  }
  return value as FrequencyBand;
}

function asObservation(value: unknown, what: string): Observation {
  const source = record(value, what);
  const file = source['file'];

  if (file !== undefined && file !== null && typeof file !== 'string') {
    throw new BadRequest(`${what}.file must be a string when present; received ${describe(file)}`);
  }

  return {
    project: string(source, 'project', what),
    subject: string(source, 'subject', what),
    component: string(source, 'component', what),
    band: asBand(source['band'], `${what}.band`),
    hash: string(source, 'hash', what) as Digest,
    profile: asProfile(source['profile'], what),
    commit: string(source, 'commit', what),
    run: string(source, 'run', what),
    at: instant(source, 'at', what),
    accepted: flag(source, 'accepted', what),
    ...(typeof file === 'string' && file !== '' ? { file } : {}),
  };
}

function asTokenValue(value: unknown, what: string): TokenValue {
  const source = record(value, what);
  return {
    project: string(source, 'project', what),
    token: string(source, 'token', what),
    value: string(source, 'value', what),
    commit: string(source, 'commit', what),
    at: instant(source, 'at', what),
  };
}
