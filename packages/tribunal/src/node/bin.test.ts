import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DATABASE_VARIABLE,
  HOST_VARIABLE,
  INGEST_TOKEN_VARIABLE,
  PORT_VARIABLE,
  PROJECT_VARIABLE,
  RETENTION_VARIABLE,
  REVIEW_TOKEN_VARIABLE,
  REVIEWER_VARIABLE,
  STORAGE_VARIABLE,
  TRUST_NETWORK_VARIABLE,
  authorizeFor,
  readArguments,
  readConfig,
  start,
  type RunningTribunal,
} from './bin.js';

/**
 * The refusals, without binding a port — and then one start that does.
 *
 * A rule that can only be exercised by launching a process is a rule that gets
 * tested once, by hand, before it is weakened.
 */

const INGEST = 'ingest-token-0123456789';
const REVIEW = 'review-token-0123456789';

function env(overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    [PROJECT_VARIABLE]: 'todomvc',
    [INGEST_TOKEN_VARIABLE]: INGEST,
    [REVIEW_TOKEN_VARIABLE]: REVIEW,
    ...overrides,
  };
}

describe('what it will not start without', () => {
  it('refuses to invent a project', () => {
    expect(() => readConfig({ ...env(), [PROJECT_VARIABLE]: '' })).toThrow(
      /scopes every row and every object key/,
    );
  });

  it('refuses a network bind nobody confirmed', () => {
    expect(() => readConfig(env({ [HOST_VARIABLE]: '0.0.0.0' }))).toThrow(
      new RegExp(TRUST_NETWORK_VARIABLE),
    );
  });

  it('takes a network bind that was confirmed, and stops serving the surface on it', () => {
    const config = readConfig(env({ [HOST_VARIABLE]: '0.0.0.0', [TRUST_NETWORK_VARIABLE]: '1' }));

    expect(config.host).toBe('0.0.0.0');
    expect(config.loopback).toBe(false);
  });

  it.each(['127.0.0.1', 'localhost', '::1'])('treats %s as reachable only from here', (host) => {
    expect(readConfig(env({ [HOST_VARIABLE]: host })).loopback).toBe(true);
  });

  it('refuses a port that is not one', () => {
    expect(() => readConfig(env({ [PORT_VARIABLE]: 'https' }))).toThrow(/whole number/);
    expect(() => readConfig(env({ [PORT_VARIABLE]: '70000' }))).toThrow(/whole number/);
  });

  it('refuses a retention of zero rather than sweeping everything', () => {
    expect(() => readConfig(env({ [RETENTION_VARIABLE]: '0' }))).toThrow(/positive number of days/);
    expect(readConfig(env()).retentionDays).toBeUndefined();
  });

  it('leaves the token rules to the constructor rather than restating them', () => {
    // A second copy of "sixteen characters, and not the same string" is a second
    // place for it to be relaxed. `readConfig` passes them through; `start` fails.
    expect(() => readConfig(env({ [INGEST_TOKEN_VARIABLE]: 'short' }))).not.toThrow();
  });

  it('resolves the database and the object directory absolutely', () => {
    const config = readConfig(env({ [DATABASE_VARIABLE]: 'a.db', [STORAGE_VARIABLE]: 'objects' }));

    expect(config.database).toMatch(/^\//);
    expect(config.storage).toMatch(/^\//);
  });
});

describe('a flag is not a way to configure this', () => {
  it('names the variable a flag was reaching for', () => {
    // What happened without this: the service started, reported success, and
    // was serving an empty database it had just created in the working
    // directory — while the operator read a startup line that looked like
    // confirmation, because it honestly said what the process did.
    expect(() => readArguments(['--database', './review.db'])).toThrow(DATABASE_VARIABLE);
    expect(() => readArguments(['--objects=./images'])).toThrow(STORAGE_VARIABLE);
  });

  it('refuses an argument it has no guess for, rather than ignoring it', () => {
    expect(() => readArguments(['serve'])).toThrow(/takes no arguments/);
  });

  it('answers --help with the variables and starts nothing', () => {
    const usage = readArguments(['--help']);

    expect(usage).toContain(PROJECT_VARIABLE);
    expect(usage).toContain(TRUST_NETWORK_VARIABLE);
  });

  it('says nothing at all when nothing was passed', () => {
    expect(readArguments([])).toBeNull();
  });
});

describe('who is allowed what', () => {
  const request = (token?: string): Request =>
    new Request('http://localhost/review/builds', {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });

  it('gives a token-holder what the token is for', () => {
    const authorize = authorizeFor(readConfig(env()));

    expect(authorize(request(INGEST))).toBe('ingest');
    expect(authorize(request(REVIEW))).toBe('review');
  });

  it('refuses a token it does not know, even on loopback', () => {
    const authorize = authorizeFor(readConfig(env()));

    // A caller that presented a credential is claiming one. Falling back to the
    // loopback grant would make a wrong token better than no token.
    expect(authorize(request('nonsense-token-01234'))).toBeNull();
  });

  it('lets the browser on this machine review with no credential', () => {
    expect(authorizeFor(readConfig(env()))(request())).toBe('review');
  });

  it('grants nothing to an anonymous caller once the socket is on a network', () => {
    const config = readConfig(env({ [HOST_VARIABLE]: '0.0.0.0', [TRUST_NETWORK_VARIABLE]: '1' }));

    expect(authorizeFor(config)(request())).toBeNull();
    expect(authorizeFor(config)(request(REVIEW))).toBe('review');
  });
});

describe('starting it', () => {
  let directory: string;
  let service: RunningTribunal | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tribunal-bin-'));
  });

  afterEach(async () => {
    await service?.close();
    service = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it('opens the file, makes the directory, binds the port and says so', async () => {
    const lines: string[] = [];
    service = await start(
      env({
        [PORT_VARIABLE]: '0',
        [DATABASE_VARIABLE]: join(directory, 'tribunal.db'),
        [STORAGE_VARIABLE]: join(directory, 'objects'),
        [REVIEWER_VARIABLE]: 'marina',
      }),
      (line) => lines.push(line),
    );

    const said = lines.join('');
    expect(said).toContain(service.url);
    expect(said).toContain(join(directory, 'tribunal.db'));
    expect(said).toContain(join(directory, 'objects'));
    expect(said).toContain('todomvc');

    // The startup line is a thing operators paste into issues.
    expect(said).not.toContain(INGEST);
    expect(said).not.toContain(REVIEW);
  });

  it('lets go of the database when the port refuses it', async () => {
    service = await start(
      env({
        [PORT_VARIABLE]: '0',
        [DATABASE_VARIABLE]: join(directory, 'tribunal.db'),
        [STORAGE_VARIABLE]: join(directory, 'objects'),
      }),
      () => {},
    );

    // A second service on a token the constructor refuses: the failure happens
    // after the file is open, and leaving it open would hold a lock against the
    // process the operator is about to start instead.
    await expect(
      start(
        env({
          [PORT_VARIABLE]: '0',
          [DATABASE_VARIABLE]: join(directory, 'second.db'),
          [STORAGE_VARIABLE]: join(directory, 'objects'),
          [INGEST_TOKEN_VARIABLE]: 'short',
        }),
        () => {},
      ),
    ).rejects.toThrow();
  });
});
