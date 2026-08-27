import { afterEach, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core';
import type { Observation, RunRecord, TokenValue } from '@variance-authority/history';
import { journeyFrom } from './answers.js';
import { createSqliteBackend } from './backend-sqlite.js';
import type { HistoryBackend } from './backend.js';

/**
 * Which recorded values a token's journey is made of.
 *
 * Its own file rather than another section of `backend-sqlite.test.ts`, because
 * every test here turns on one fact that none of the others do: **a run writes
 * its rows unapproved**. `variance run` records what it observed at the moment it
 * observed it, and `variance accept` follows minutes or days later, from another
 * process, keyed by run id.
 *
 * A journey is the sum of the changes somebody agreed to ship, so that join is
 * the whole answer — and it is the join this store shipped without. Values were
 * filtered on an acceptance flag stamped at write time, which no real run can
 * ever set, so every journey came back empty; `detectDrift` reads an empty
 * journey as `null` and `null` means *this token has not moved*. The failure was
 * not a crash or a wrong number. It was the reassuring sentence, on every run, for
 * a token that had crept 6px across three approvals.
 *
 * So each test below names an order of events rather than a query.
 */

/** The fixture preamble, duplicated from its neighbour rather than shared; see there. */
const open = (path = ':memory:'): HistoryBackend => createSqliteBackend({ path });

const backends: HistoryBackend[] = [];

function track(backend: HistoryBackend): HistoryBackend {
  backends.push(backend);
  return backend;
}

afterEach(async () => {
  for (const backend of backends.splice(0)) await backend.close();
});

function run(fields: Partial<RunRecord> = {}): RunRecord {
  return {
    project: 'shop',
    run: 'run-1',
    commit: 'aaaa',
    profile: 'jsdom',
    at: '2026-03-01T10:00:00.000Z',
    ...fields,
  } as RunRecord;
}

function observation(fields: Partial<Observation> = {}): Observation {
  return {
    project: 'shop',
    subject: 'checkout',
    component: 'Button',
    band: 'structure',
    hash: 'h-1' as Digest,
    profile: 'jsdom',
    commit: 'aaaa',
    run: 'run-1',
    at: '2026-03-01T10:00:00.000Z',
    // False, unlike the neighbouring fixture's default, because that is what a
    // run writes. A journey fixture that started from approved rows would be a
    // fixture of a store nobody has ever used.
    accepted: false,
    ...fields,
  } as Observation;
}

function token(fields: Partial<TokenValue> = {}): TokenValue {
  return {
    project: 'shop',
    token: '--va-space-3',
    value: '12px',
    commit: 'aaaa',
    at: '2026-03-01T10:00:00.000Z',
    ...fields,
  } as TokenValue;
}

/** The decision a run cannot make about itself, arriving after it. */
async function approve(backend: HistoryBackend, ...runs: readonly string[]): Promise<void> {
  await backend.appendApprovals(
    runs.map((id) => ({
      project: 'shop',
      subject: 'checkout',
      run: id,
      at: '2026-04-01T10:00:00.000Z',
    })),
  );
}

describe('a token journey', () => {
  it('holds the values of runs written unapproved and accepted afterwards', async () => {
    // The order every operator actually works in, and the one this used to get
    // wrong: `variance run` writes its rows the moment it observes them, so every
    // row it writes is unapproved, and `variance accept` follows minutes or days
    // later. Filtering values on what the *write* knew returned an empty journey
    // for every real project — and an empty journey is not an error, it is
    // `detectDrift` answering `null`: this token has not moved.
    const backend = track(open());

    for (const index of [1, 2, 3]) {
      const at = `2026-03-0${index}T10:00:00.000Z`;
      await backend.append(
        run({ run: `r${index}`, commit: `c${index}`, at }),
        [
          observation({
            run: `r${index}`,
            commit: `c${index}`,
            at,
            hash: `h${index}` as Digest,
            accepted: false,
          }),
        ],
        [token({ commit: `c${index}`, at, value: `${10 + index * 2}px` })],
      );
    }

    expect((await journeyFrom(backend, 'shop', '--va-space-3', {})).values).toEqual([]);

    await approve(backend, 'r1', 'r2', 'r3');

    const journey = await journeyFrom(backend, 'shop', '--va-space-3', {});
    expect(journey.values.map((value) => value.value)).toEqual(['12px', '14px', '16px']);
    // Spec 0002 acceptance 1: an exact journey with a commit per step.
    expect(journey.values.map((value) => value.commit)).toEqual(['c1', 'c2', 'c3']);
  });

  it('counts a value whose commit belongs to no recorded run rather than shortening the journey', async () => {
    // The join runs through the commit, which is what a `TokenValue` carries. A
    // writer that sent a value stamped with a commit its own run does not claim
    // has made the value unjoinable — so it is counted as omitted, which makes
    // the journey incomplete and makes `detectDrift` refuse rather than return a
    // shorter total that looks exactly like a real one.
    const backend = track(open());

    await backend.append(
      run({ run: 'r1', commit: 'c1' }),
      [observation({ run: 'r1', commit: 'c1' })],
      [token({ commit: 'not-a-recorded-commit', value: '12px' })],
    );
    await approve(backend, 'r1');

    const journey = await journeyFrom(backend, 'shop', '--va-space-3', {});
    expect([journey.values.length, journey.omitted]).toEqual([0, 1]);
  });

  it('excludes a token value from a run nobody approved', async () => {
    // A rejected change was caught and never shipped; its resolved values would
    // otherwise become steps in a journey through a product that never existed.
    const backend = track(open());

    for (const [index, value] of [[1, '12px'], [2, '99px'], [3, '20px']] as const) {
      const at = `2026-03-0${index}T10:00:00.000Z`;
      await backend.append(
        run({ run: `r${index}`, commit: `c${index}`, at }),
        [observation({ run: `r${index}`, commit: `c${index}`, at, hash: `h${index}` as Digest })],
        [token({ commit: `c${index}`, at, value })],
      );
    }

    await approve(backend, 'r1', 'r3');

    const journey = await journeyFrom(backend, 'shop', '--va-space-3', {});
    expect(journey.values.map((value) => value.value)).toEqual(['12px', '20px']);
    // Excluded by the question, not by a limit: an unapproved value is not a
    // missing step, and calling it one would mark every journey incomplete.
    expect(journey.omitted).toBe(0);
  });

  it('keeps the values of a write whose approval covered only part of it', async () => {
    // The case `RunContext` documents: half a run's components decided
    // separately. Excluding a value that did ship removes a step from the sum the
    // whole store exists to compute, and nothing on the page contradicts the
    // smaller number.
    const backend = track(open());

    await backend.append(
      run({ run: 'r1', commit: 'c1' }),
      [observation({ run: 'r1', commit: 'c1', accepted: false })],
      [token({ commit: 'c1', value: '12px' })],
    );
    await backend.append(
      run({ run: 'mixed', commit: 'c2', at: '2026-03-02T10:00:00.000Z' }),
      [
        observation({ run: 'mixed', commit: 'c2', at: '2026-03-02T10:00:00.000Z', accepted: false }),
        observation({
          run: 'mixed',
          commit: 'c2',
          at: '2026-03-02T10:00:00.000Z',
          subject: 'settings',
          component: 'Toggle',
          accepted: false,
        }),
      ],
      [token({ commit: 'c2', at: '2026-03-02T10:00:00.000Z', value: '14px' })],
    );

    await approve(backend, 'r1', 'mixed');

    expect(
      (await journeyFrom(backend, 'shop', '--va-space-3', {})).values.map((value) => value.value),
    ).toEqual(['12px', '14px']);
  });
});
