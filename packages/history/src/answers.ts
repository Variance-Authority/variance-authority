import {
  BANDS as FREQUENCY_BANDS,
  profileById,
  type Digest,
  type ProfileId,
} from '@variance-authority/core';
import type { FrequencyBand } from './instability.js';
import { BANDS, type Band, type Observation, type TokenValue } from './observation.js';
import type { BandChurn, Churn, Flakiness, FlakyCause, Journey, Reach, Window } from './store.js';

/**
 * Every answer the service gives, checked before it becomes a number.
 *
 * Split from `client.ts` because it is a different job from speaking HTTP:
 * nothing here opens a socket, so the whole of it is exercised by handing it a
 * parsed body. It is the mirror of the service's own `http-parse.ts`, which
 * refuses malformed writes at the same boundary from the other side.
 *
 * Not paranoia about the operator's own service. A field missing from a JSON body
 * becomes `undefined`, `undefined` in an arithmetic sentence becomes `NaN`, and
 * `NaN` printed next to a component name is indistinguishable at a glance from a
 * finding. Failing here keeps a version mismatch between the client and the
 * service from turning into a plausible report.
 */

export function asRecord(
  value: unknown,
  url: string,
  what: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`history service ${url} returned ${describe(value)} where ${what} was expected`);
  }
  return value as Readonly<Record<string, unknown>>;
}

export function asArray(value: unknown, url: string, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`history service ${url} returned ${describe(value)} where ${what} was expected`);
  }
  return value as readonly unknown[];
}

function text(
  source: Readonly<Record<string, unknown>>,
  key: string,
  url: string,
  what: string,
): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new Error(`history service ${url} returned ${what} whose \`${key}\` is ${describe(value)}`);
  }
  return value;
}

function count(
  source: Readonly<Record<string, unknown>>,
  key: string,
  url: string,
  what: string,
): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`history service ${url} returned ${what} whose \`${key}\` is ${describe(value)}`);
  }
  return value;
}

function flag(
  source: Readonly<Record<string, unknown>>,
  key: string,
  url: string,
  what: string,
): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    throw new Error(`history service ${url} returned ${what} whose \`${key}\` is ${describe(value)}`);
  }
  return value;
}

function optionalText(
  source: Readonly<Record<string, unknown>>,
  key: string,
  url: string,
  what: string,
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`history service ${url} returned ${what} whose \`${key}\` is ${describe(value)}`);
  }
  return value;
}

function asBand(value: unknown, url: string, what: string): Band {
  if (typeof value !== 'string' || !BANDS.includes(value as Band)) {
    throw new Error(`history service ${url} returned ${what} with an unknown band ${describe(value)}`);
  }
  return value as Band;
}

/**
 * Profile ids are checked against `core`'s own table rather than a list here.
 *
 * A literal list would go stale the day `core` gains a tier, and this client would
 * then reject rows the rest of the system considers valid. The assignment to
 * `unknown` is what makes the lookup's runtime miss visible: `profileById` is
 * typed total over `ProfileId`, and the value being checked is not one yet.
 */
function asProfile(value: unknown, url: string, what: string): ProfileId {
  const known: unknown =
    typeof value === 'string' ? profileById(value as ProfileId) : undefined;

  if (known === undefined) {
    throw new Error(
      `history service ${url} returned ${what} with an unknown profile ${describe(value)}`,
    );
  }
  return value as ProfileId;
}

export function asObservation(value: unknown, url: string): Observation {
  const what = 'an observation';
  const source = asRecord(value, url, what);
  const file = optionalText(source, 'file', url, what);

  return {
    project: text(source, 'project', url, what),
    subject: text(source, 'subject', url, what),
    component: text(source, 'component', url, what),
    band: asBand(source['band'], url, what),
    hash: text(source, 'hash', url, what) as Digest,
    profile: asProfile(source['profile'], url, what),
    commit: text(source, 'commit', url, what),
    run: text(source, 'run', url, what),
    at: text(source, 'at', url, what),
    accepted: flag(source, 'accepted', url, what),
    ...(file !== undefined ? { file } : {}),
  };
}

export function asFlakiness(value: unknown, url: string): Flakiness {
  const what = 'a flakiness record';
  const source = asRecord(value, url, what);

  const causes = asArray(source['causes'], url, `${what}'s causes`).map((entry): FlakyCause => {
    const cause = asRecord(entry, url, 'a flakiness cause');
    const component = optionalText(cause, 'component', url, 'a flakiness cause');
    const band = cause['band'];

    return {
      ...(component !== undefined ? { component } : {}),
      ...(band === undefined || band === null
        ? {}
        : { band: asFrequencyBand(band, url, 'a flakiness cause') }),
      runs: count(cause, 'runs', url, 'a flakiness cause'),
    };
  });

  const rate = source['rate'];
  const firstAt = optionalText(source, 'firstAt', url, what);
  const lastAt = optionalText(source, 'lastAt', url, what);
  const lastRun = optionalText(source, 'lastRun', url, what);

  return {
    subject: text(source, 'subject', url, what),
    window: asWindow(source['window'], url, what),
    runs: count(source, 'runs', url, what),
    sweeps: count(source, 'sweeps', url, what),
    occurrences: count(source, 'occurrences', url, what),
    absorbedRuns: count(source, 'absorbedRuns', url, what),
    // Absent is carried through as absent. A rate defaulted to zero here would
    // turn "no sweep has ever asked" into "it never flakes", which is the one
    // sentence this package refuses to let a missing field produce.
    ...(rate === undefined || rate === null ? {} : { rate: count(source, 'rate', url, what) }),
    sweepsSince: count(source, 'sweepsSince', url, what),
    causes,
    ...(firstAt !== undefined ? { firstAt } : {}),
    ...(lastAt !== undefined ? { lastAt } : {}),
    ...(lastRun !== undefined ? { lastRun } : {}),
    omittedRuns: count(source, 'omittedRuns', url, what),
    omittedOccurrences: count(source, 'omittedOccurrences', url, what),
  };
}

/** Checked against `core`'s own list, for the reason `asProfile` is. */
function asFrequencyBand(value: unknown, url: string, what: string): FrequencyBand {
  if (typeof value !== 'string' || !FREQUENCY_BANDS.includes(value as FrequencyBand)) {
    throw new Error(
      `history service ${url} returned ${what} with an unknown frequency band ${describe(value)}`,
    );
  }
  return value as FrequencyBand;
}

function asTokenValue(value: unknown, url: string): TokenValue {
  const what = 'a token value';
  const source = asRecord(value, url, what);

  return {
    project: text(source, 'project', url, what),
    token: text(source, 'token', url, what),
    value: text(source, 'value', url, what),
    commit: text(source, 'commit', url, what),
    at: text(source, 'at', url, what),
  };
}

export function asChurn(value: unknown, url: string): Churn {
  const what = 'a churn record';
  const source = asRecord(value, url, what);

  const bands = asArray(source['bands'], url, `${what}'s bands`).map((entry): BandChurn => {
    const band = asRecord(entry, url, 'a band churn');
    const profile = band['profile'];

    return {
      band: asBand(band['band'], url, 'a band churn'),
      ...(profile === undefined || profile === null
        ? {}
        : { profile: asProfile(profile, url, 'a band churn') }),
      runs: count(band, 'runs', url, 'a band churn'),
      changes: count(band, 'changes', url, 'a band churn'),
      rate: count(band, 'rate', url, 'a band churn'),
    };
  });

  const firstAt = optionalText(source, 'firstAt', url, what);
  const lastAt = optionalText(source, 'lastAt', url, what);

  return {
    component: text(source, 'component', url, what),
    window: asWindow(source['window'], url, what),
    runs: count(source, 'runs', url, what),
    changedRuns: count(source, 'changedRuns', url, what),
    bands,
    collateralRuns: count(source, 'collateralRuns', url, what),
    rejectedRuns: count(source, 'rejectedRuns', url, what),
    ...(firstAt !== undefined ? { firstAt } : {}),
    ...(lastAt !== undefined ? { lastAt } : {}),
    omittedRuns: count(source, 'omittedRuns', url, what),
    omittedObservations: count(source, 'omittedObservations', url, what),
  };
}

export function asJourney(value: unknown, url: string): Journey {
  const what = 'a value journey';
  const source = asRecord(value, url, what);

  return {
    token: text(source, 'token', url, what),
    window: asWindow(source['window'], url, what),
    values: asArray(source['values'], url, `${what}'s values`).map((entry) =>
      asTokenValue(entry, url),
    ),
    // Required rather than defaulted to zero: a service that forgets to report
    // what it left out would make every truncated journey read as a whole one.
    omitted: count(source, 'omitted', url, what),
  };
}

export function asReach(value: unknown, url: string): Reach {
  const what = 'a reach record';
  const source = asRecord(value, url, what);

  const strings = (key: string): readonly string[] =>
    asArray(source[key], url, `${what}'s ${key}`).map((entry) => {
      if (typeof entry !== 'string') {
        throw new Error(
          `history service ${url} returned ${what} whose \`${key}\` contains ${describe(entry)}`,
        );
      }
      return entry;
    });

  return {
    component: text(source, 'component', url, what),
    window: asWindow(source['window'], url, what),
    subjects: strings('subjects'),
    arrived: strings('arrived'),
    omittedSubjects: count(source, 'omittedSubjects', url, what),
  };
}

/** The window is echoed back so a caller can see the bounds the answer used. */
function asWindow(value: unknown, url: string, what: string): Window {
  if (value === undefined || value === null) return {};
  const source = asRecord(value, url, `${what}'s window`);

  const since = optionalText(source, 'since', url, what);
  const until = optionalText(source, 'until', url, what);
  const limit = source['limit'];

  return {
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(limit === undefined || limit === null
      ? {}
      : { limit: count(source, 'limit', url, what) }),
  };
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `${typeof value} (${JSON.stringify(value)?.slice(0, 80) ?? ''})`;
}
