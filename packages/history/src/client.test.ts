import { describe, expect, it } from 'vitest';
import { createHttpHistoryStore, type RecordRequest } from './client.js';
import { MAX_CURRENT_SUBJECTS } from './protocol.js';
import type { Churn } from './store.js';
import { isKept } from './store.js';
import type { Observation, RunRecord } from './observation.js';

/**
 * The client, against a stub transport.
 *
 * One claim dominates this file: **a failure is a failure, never an empty
 * answer.** Every other property here — the token, the query parameters, the
 * shape checks — is in service of it, because each of them has a failure mode
 * whose end state is a `Churn` full of zeroes, and a `Churn` full of zeroes is
 * printed as "nothing has drifted" by a caller that has no way to know better.
 */

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

type Responder = (url: string, init: RequestInit | undefined) => unknown;

function stubFetch(responder: Responder): typeof globalThis.fetch & { readonly calls: Call[] } {
  const calls: Call[] = [];

  const send = (async (input: unknown, init: RequestInit | undefined) => {
    calls.push({ url: String(input), init });
    const answer = await responder(String(input), init);
    if (answer instanceof Response) return answer;
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;

  return Object.assign(send, { calls });
}

const RUN: RunRecord = {
  project: 'shop',
  run: 'r1',
  commit: 'c1',
  profile: 'chromium',
  at: '2026-01-01T00:00:00Z',
};

const OBSERVATION: Observation = {
  project: 'shop',
  subject: 'story:card',
  component: 'Button',
  band: 'style',
  hash: 'v1:abc',
  profile: 'chromium',
  commit: 'c1',
  run: 'r1',
  at: '2026-01-01T00:00:00Z',
  accepted: true,
};

const EMPTY_CHURN: Churn = {
  component: 'Button',
  window: {},
  runs: 0,
  changedRuns: 0,
  bands: [],
  collateralRuns: 0,
  rejectedRuns: 0,
  omittedRuns: 0,
  omittedObservations: 0,
};

describe('the history client', () => {
  it('sends the operator’s bearer token with the run and its rows in one body', () => {
    const send = stubFetch(() => new Response(null, { status: 204 }));
    const store = createHttpHistoryStore({ endpoint: 'http://box:7788/', token: 'sekrit', fetch: send });

    return store.record(RUN, [OBSERVATION], []).then(() => {
      const [call] = send.calls;
      const headers = call?.init?.headers as Record<string, string>;
      const body = JSON.parse(String(call?.init?.body)) as RecordRequest;

      expect(call?.url).toBe('http://box:7788/v1/observations');
      expect(headers['authorization']).toBe('Bearer sekrit');
      // The run travels with the rows so a service can commit both or neither:
      // rows without their run leave a change with no denominator.
      expect(body.run).toEqual(RUN);
      expect(body.observations).toEqual([OBSERVATION]);
    });
  });

  it('throws on a transport failure rather than resolving to an empty churn', async () => {
    const send = stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const store = createHttpHistoryStore({ endpoint: 'http://box:7788', token: 't', fetch: send });

    // The entire reason this client exists rather than a two-line wrapper.
    await expect(store.churn('Button', {})).rejects.toThrow(/could not be reached/);
    await expect(store.churn('Button', {})).rejects.toThrow(/nothing has drifted/);
  });

  it('throws with the status when the service refuses the token', async () => {
    const send = stubFetch(() => new Response('bad token', { status: 401 }));
    const store = createHttpHistoryStore({ endpoint: 'http://box:7788', token: 'wrong', fetch: send });

    // A 401 answered with an empty history would report a misconfigured token as
    // a stable product.
    await expect(store.churn('Button', {})).rejects.toThrow(/returned 401: bad token/);
  });

  it('throws when a field the arithmetic needs is missing from the body', async () => {
    const send = stubFetch(() => ({ ...EMPTY_CHURN, changedRuns: undefined }));
    const store = createHttpHistoryStore({ endpoint: 'http://box:7788', token: 't', fetch: send });

    // A missing field becomes `undefined`, which becomes `NaN`, which is printed
    // next to a component name and read as a finding.
    await expect(store.churn('Button', {})).rejects.toThrow(/`changedRuns` is nothing/);
  });

  it('returns an empty churn from a live service as a real answer', async () => {
    const send = stubFetch(() => EMPTY_CHURN);
    const store = createHttpHistoryStore({ endpoint: 'http://box:7788', token: 't', fetch: send });

    // "The record exists and contains nothing about this window" is a different
    // sentence from "no record is being kept", and this is the half that is kept.
    const answer = await store.churn('Button', {});
    expect(isKept(answer)).toBe(true);
    expect(isKept(answer) ? answer.runs : -1).toBe(0);
  });

  it('carries the window bounds and the project as parameters', async () => {
    const send = stubFetch(() => EMPTY_CHURN);
    const store = createHttpHistoryStore({
      endpoint: 'http://box:7788',
      token: 't',
      project: 'shop',
      fetch: send,
    });

    await store.churn('Button', { since: '2026-01-01T00:00:00Z', limit: 50 });

    // Without the project, two projects' `Button` blend into one rate and nothing
    // in the answer shows it.
    const url = new URL(send.calls[0]!.url);
    expect(url.searchParams.get('component')).toBe('Button');
    expect(url.searchParams.get('since')).toBe('2026-01-01T00:00:00Z');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('project')).toBe('shop');
  });

  it('refuses to write rows belonging to another project', async () => {
    const send = stubFetch(() => new Response(null, { status: 204 }));
    const store = createHttpHistoryStore({
      endpoint: 'http://box:7788',
      token: 't',
      project: 'shop',
      fetch: send,
    });

    await expect(
      store.record(RUN, [{ ...OBSERVATION, project: 'other' }], []),
    ).rejects.toThrow(/scoped to project "shop"/);
    // Refused before the request, not after it: a row written under the wrong
    // project answers every later question about both of them wrongly.
    expect(send.calls).toHaveLength(0);
  });

  it('fails a request that hangs rather than stalling the run', async () => {
    const send = stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const store = createHttpHistoryStore({
      endpoint: 'http://box:7788',
      token: 't',
      fetch: send,
      timeoutMs: 10,
    });

    await expect(store.churn('Button', {})).rejects.toThrow(/did not answer within 10ms/);
  });

  it('keeps a null last-change as null and parses a real one', async () => {
    const empty = createHttpHistoryStore({
      endpoint: 'http://box:7788',
      token: 't',
      fetch: stubFetch(() => ({ observation: null })),
    });
    const found = createHttpHistoryStore({
      endpoint: 'http://box:7788',
      token: 't',
      fetch: stubFetch(() => ({ observation: OBSERVATION })),
    });

    // `null` means the record contains no such change — an answer, and not the
    // same as the absent store's refusal.
    await expect(empty.lastChanged('story:card', 'Button')).resolves.toBeNull();
    await expect(found.lastChanged('story:card', 'Button')).resolves.toEqual(OBSERVATION);
  });

  it('splits a long subject list across requests and concatenates the answers', async () => {
    // The answer is never trimmed to fit a request, so the *question* is what
    // gets split. The alternative — one enormous request — is refused by the
    // service, and the alternative to that is a `previous` set with a hole in it,
    // which becomes a change that did not happen.
    const send = stubFetch((_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { subjects: string[] };
      return { observations: body.subjects.map((subject) => ({ ...OBSERVATION, subject })) };
    });
    const store = createHttpHistoryStore({ endpoint: 'http://box:7788', token: 't', fetch: send });

    const subjects = Array.from({ length: MAX_CURRENT_SUBJECTS + 30 }, (_, index) => `s${index}`);
    const answer = await store.current(subjects);

    expect(send.calls).toHaveLength(2);
    expect(answer.observations.map((row) => row.subject)).toEqual(subjects);
    // A read, and still a POST: three hundred subject ids in a query string is a
    // 414 from a proxy nobody configured.
    expect(send.calls[0]?.init?.method).toBe('POST');
  });

  it('asks nobody about nobody, and asks about a repeated subject once', async () => {
    const send = stubFetch(() => ({ observations: [] }));
    const store = createHttpHistoryStore({ endpoint: 'http://box:7788', token: 't', fetch: send });

    await expect(store.current([])).resolves.toEqual({ observations: [], tokens: [] });
    expect(send.calls).toHaveLength(0);

    await store.current(['a', 'a', 'b']);
    expect(JSON.parse(String(send.calls[0]?.init?.body ?? '{}'))).toEqual({ subjects: ['a', 'b'] });
  });

  it('rejects a row whose band or tier it does not recognise', async () => {
    const send = stubFetch(() => ({ observation: { ...OBSERVATION, profile: 'webkit' } }));
    const store = createHttpHistoryStore({ endpoint: 'http://box:7788', token: 't', fetch: send });

    // A tier this build has never heard of cannot be compared against anything
    // here, and accepting it would put an uncomparable row into a rate.
    await expect(store.lastChanged('story:card', 'Button')).rejects.toThrow(/unknown profile/);
  });
});
