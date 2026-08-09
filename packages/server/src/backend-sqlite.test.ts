import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core';
import type { Observation, RunRecord, TokenValue } from '@variance-authority/history';
import { churnFrom, journeyFrom, lastChangedFrom, reachFrom } from './backend.js';
import { SCHEMA_VERSION, createSqliteBackend } from './backend-sqlite.js';
import type { HistoryBackend } from './backend.js';

/**
 * The storage engine, held to the promises the interface makes for it.
 *
 * Every test below is a claim about something that is invisible when it goes
 * wrong. A store that silently overwrites a row, that counts one run twice, or
 * that compares timestamps as text produces numbers that look exactly like
 * correct numbers — so the assertions are written against the *reason* each rule
 * exists rather than against the SQL that implements it.
 */

/** Same runtime require as the backend, and for the same reason; see there. */
const { DatabaseSync: Database } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

const open = (path = ':memory:'): HistoryBackend => createSqliteBackend({ path });

const backends: HistoryBackend[] = [];
const directories: string[] = [];

function track(backend: HistoryBackend): HistoryBackend {
  backends.push(backend);
  return backend;
}

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'variance-history-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const backend of backends.splice(0)) await backend.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
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
    accepted: true,
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

describe('schema', () => {
  it('returns a written observation field for field, including the absence of a file', async () => {
    // Guards against a round trip that quietly changes the shape — a `file` read
    // back as the string "null", or `accepted` returned as the number 1. Either
    // would reach a report as a plausible sentence.
    const backend = track(open());
    const bare = observation();
    const located = observation({
      component: 'Toggle',
      hash: 'h-2' as Digest,
      file: 'src/Toggle.tsx',
    });

    await backend.append(run(), [bare, located], [token()]);

    expect(await lastChangedFrom(backend, 'shop', 'checkout', 'Button')).toEqual(bare);
    expect(await lastChangedFrom(backend, 'shop', 'checkout', 'Toggle')).toEqual(located);
    expect('file' in (await lastChangedFrom(backend, 'shop', 'checkout', 'Button'))!).toBe(false);
  });

  it('refuses a database written by a newer schema version instead of misreading it', async () => {
    // The failure this prevents has no symptom: a newer shape read through older
    // assumptions answers drift questions with numbers that are wrong and
    // well-formed.
    const path = join(scratch(), 'history.db');
    await open(path).close();

    const raw = new Database(path);
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    raw.close();

    expect(() => open(path)).toThrow(/schema version 2.*understands 1/s);
  });

  it('refuses an existing database that carries no schema version of ours', async () => {
    // `CREATE TABLE IF NOT EXISTS` would have adopted somebody else's file and
    // started appending a history into it.
    const path = join(scratch(), 'foreign.db');
    const raw = new Database(path);
    raw.exec('CREATE TABLE unrelated (a TEXT)');
    raw.close();

    expect(() => open(path)).toThrow(/written by something else/);
  });
});

describe('append-only', () => {
  it('refuses an UPDATE against a stored observation at the database level', async () => {
    // Enforced by a trigger rather than by the code above it, because the rule
    // has to survive a second connection and a SQL prompt. An overwritten row is
    // the merge this store exists to avoid, arriving through the back door.
    const path = join(scratch(), 'history.db');
    const backend = track(open(path));
    await backend.append(run(), [observation()], []);

    const raw = new Database(path);
    expect(() => raw.exec("UPDATE observations SET hash = 'forged'")).toThrow(/append-only/);
    expect(() => raw.exec('DELETE FROM observations')).toThrow(/append-only/);
    raw.close();

    expect((await lastChangedFrom(backend, 'shop', 'checkout', 'Button'))?.hash).toBe('h-1');
  });

  it('keeps both observations when two commits report different hashes for one key', async () => {
    // The whole reason this is a service and not a file. Two branches observing
    // one key are two facts; a store that upserted would keep whichever landed
    // last and answer every later question from a state neither branch was in.
    const backend = track(open());

    await backend.append(
      run({ run: 'run-a', commit: 'branch-a' }),
      [observation({ run: 'run-a', commit: 'branch-a', hash: 'hash-a' as Digest })],
      [],
    );
    await backend.append(
      run({ run: 'run-b', commit: 'branch-b', at: '2026-03-01T11:00:00.000Z' }),
      [
        observation({
          run: 'run-b',
          commit: 'branch-b',
          hash: 'hash-b' as Digest,
          at: '2026-03-01T11:00:00.000Z',
        }),
      ],
      [],
    );

    const stored = await backend.observationsOf({ project: 'shop', component: 'Button' });
    expect(stored.rows.map((row) => [row.commit, row.hash])).toEqual([
      ['branch-a', 'hash-a'],
      ['branch-b', 'hash-b'],
    ]);
    expect(stored.omitted).toBe(0);
    // Neither write needed the other, and no merge happened anywhere.
    expect((await lastChangedFrom(backend, 'shop', 'checkout', 'Button'))?.commit).toBe('branch-b');
  });

  it('records one run once however many writes carry it', async () => {
    // A run whose components were approved separately is written twice. Counting
    // it twice halves every rate derived from it, forever, in the reassuring
    // direction.
    const backend = track(open());
    await backend.append(run(), [observation()], []);
    await backend.append(run(), [observation({ component: 'Toggle', hash: 'h-9' as Digest })], []);

    expect((await backend.runsIn({ project: 'shop' })).rows).toHaveLength(1);
  });

  it('refuses a second write that claims a different commit for one run id', async () => {
    // Lineage is what a store of observations offers instead of a merge. A run id
    // pointing at two commits makes every lineage question unanswerable, quietly.
    const backend = track(open());
    await backend.append(run(), [], []);

    await expect(backend.append(run({ commit: 'bbbb' }), [], [])).rejects.toThrow(
      /already recorded at commit aaaa/,
    );
  });

  it('refuses a row whose timestamp is not an instant rather than storing it', async () => {
    // An unparseable `at` cannot be taken out of an append-only store, and it
    // orders a journey wrongly — `12px → 20px` printed backwards.
    const backend = track(open());
    await expect(backend.append(run(), [observation({ at: 'yesterday' })], [])).rejects.toThrow(
      /not an ISO-8601 instant/,
    );
    expect((await backend.observationsOf({ component: 'Button' })).rows).toHaveLength(0);
  });
});

describe('queries', () => {
  it('narrows lastChanged to one band and answers null for an area it has never seen', async () => {
    const backend = track(open());
    await backend.append(
      run({ profile: 'chromium' }),
      [
        observation({ profile: 'chromium', band: 'structure', hash: 's' as Digest }),
        observation({
          profile: 'chromium',
          band: 'geometry',
          hash: 'g' as Digest,
          at: '2026-03-01T10:30:00.000Z',
        }),
      ],
      [],
    );

    expect((await lastChangedFrom(backend, 'shop', 'checkout', 'Button'))?.band).toBe('geometry');
    expect(
      (await lastChangedFrom(backend, 'shop', 'checkout', 'Button', 'structure'))?.hash,
    ).toBe('s');
    // `null` is an answer from a store that keeps a record: it has looked.
    expect(await lastChangedFrom(backend, 'shop', 'cart', 'Button')).toBeNull();
  });

  it('counts quiet runs in the churn denominator and the same history without them does not', async () => {
    // Spec 0002 acceptance 3, kept as one test so the reason stays visible: the
    // only difference between 25% and 100% here is whether the runs that changed
    // nothing were recorded.
    const withQuiet = track(open());
    const withoutQuiet = track(open());

    for (const [index, backend] of [withQuiet, withoutQuiet].entries()) {
      await backend.append(
        run({ run: 'r1', commit: 'c1' }),
        [observation({ run: 'r1', commit: 'c1' })],
        [],
      );
      if (index === 0) {
        for (const quiet of ['r2', 'r3', 'r4']) {
          await backend.append(run({ run: quiet, commit: quiet, at: `2026-03-0${quiet[1]!}T10:00:00.000Z` }), [], []);
        }
      }
    }

    const honest = await churnFrom(withQuiet, 'shop', 'Button', {});
    const inflated = await churnFrom(withoutQuiet, 'shop', 'Button', {});

    expect([honest.changedRuns, honest.runs]).toEqual([1, 4]);
    expect([inflated.changedRuns, inflated.runs]).toEqual([1, 1]);
    expect(honest.bands.find((band) => band.band === 'structure')?.rate).toBe(0.25);
    expect(inflated.bands.find((band) => band.band === 'structure')?.rate).toBe(1);
  });

  it('reports what a limit excluded instead of returning a smaller history', async () => {
    // A capped answer that does not say it was capped reads as a complete one,
    // and a drift total over a truncated window is a lower bound its reader will
    // treat as the amount the product moved.
    const backend = track(open());
    for (const index of [1, 2, 3, 4]) {
      const at = `2026-03-0${index}T10:00:00.000Z`;
      await backend.append(
        run({ run: `r${index}`, commit: `c${index}`, at }),
        [observation({ run: `r${index}`, commit: `c${index}`, at, hash: `h${index}` as Digest })],
        [token({ commit: `c${index}`, at, value: `${10 + index * 2}px` })],
      );
    }

    const churn = await churnFrom(backend, 'shop', 'Button', { limit: 2 });
    expect([churn.runs, churn.omittedRuns, churn.omittedObservations]).toEqual([2, 2, 2]);

    const journey = await journeyFrom(backend, 'shop', '--va-space-3', { limit: 2 });
    expect(journey.values.map((value) => value.value)).toEqual(['16px', '18px']);
    expect(journey.omitted).toBe(2);
  });

  it('counts a row whose run a limit cut away rather than crediting it to a missing denominator', async () => {
    // The one place two independently limited slices can disagree: the newest
    // rows and the newest runs are not the same set. A surviving row whose run
    // was cut would add to a numerator with nothing under it — a rate above its
    // true value, in the alarming direction, with nothing on the page to say so.
    // Every such row is excluded from the arithmetic and counted in the output.
    const backend = track(open());

    await backend.append(
      run({ run: 'busy', commit: 'c1' }),
      ['a', 'b', 'c', 'd', 'e'].map((suffix) =>
        observation({ run: 'busy', commit: 'c1', subject: `page-${suffix}`, hash: suffix as Digest }),
      ),
      [],
    );
    await backend.append(
      run({ run: 'later', commit: 'c2', at: '2026-03-05T10:00:00.000Z' }),
      [],
      [],
    );

    const churn = await churnFrom(backend, 'shop', 'Button', { limit: 1 });
    expect([churn.runs, churn.changedRuns]).toEqual([1, 0]);
    // Four excluded by the limit, one stranded by it — all five accounted for.
    expect(churn.omittedObservations).toBe(5);
    expect(churn.omittedRuns).toBe(1);
  });

  it('excludes a token value from a write in which nothing was approved', async () => {
    // A rejected change was caught and never shipped; its resolved values would
    // otherwise become steps in a journey through a product that never existed.
    const backend = track(open());

    await backend.append(run({ run: 'r1', commit: 'c1' }), [observation({ run: 'r1', commit: 'c1' })], [token({ commit: 'c1', value: '12px' })]);
    await backend.append(
      run({ run: 'r2', commit: 'c2', at: '2026-03-02T10:00:00.000Z' }),
      [observation({ run: 'r2', commit: 'c2', at: '2026-03-02T10:00:00.000Z', accepted: false })],
      [token({ commit: 'c2', at: '2026-03-02T10:00:00.000Z', value: '99px' })],
    );
    await backend.append(
      run({ run: 'r3', commit: 'c3', at: '2026-03-03T10:00:00.000Z' }),
      [observation({ run: 'r3', commit: 'c3', at: '2026-03-03T10:00:00.000Z' })],
      [token({ commit: 'c3', at: '2026-03-03T10:00:00.000Z', value: '20px' })],
    );

    const journey = await journeyFrom(backend, 'shop', '--va-space-3', {});
    expect(journey.values.map((value) => value.value)).toEqual(['12px', '20px']);
    // Spec 0002 acceptance 1: an exact journey with a commit per step.
    expect(journey.values.map((value) => value.commit)).toEqual(['c1', 'c3']);
  });

  it('keeps the values of a quiet run and of a write that mixes approval with rejection', async () => {
    // The asymmetry is deliberate. Excluding a value that did ship removes a step
    // from the sum the whole store exists to compute, and nothing on the page
    // contradicts the smaller number.
    const backend = track(open());

    await backend.append(run({ run: 'quiet', commit: 'c0' }), [], [token({ commit: 'c0', value: '12px' })]);
    await backend.append(
      run({ run: 'mixed', commit: 'c1', at: '2026-03-02T10:00:00.000Z' }),
      [
        observation({ run: 'mixed', commit: 'c1', at: '2026-03-02T10:00:00.000Z' }),
        observation({
          run: 'mixed',
          commit: 'c1',
          at: '2026-03-02T10:00:00.000Z',
          component: 'Toggle',
          accepted: false,
        }),
      ],
      [token({ commit: 'c1', at: '2026-03-02T10:00:00.000Z', value: '14px' })],
    );

    expect(
      (await journeyFrom(backend, 'shop', '--va-space-3', {})).values.map((value) => value.value),
    ).toEqual(['12px', '14px']);
  });

  it('separates the subjects a component appears in from the ones it arrived in', async () => {
    // `arrived` needs a lookup outside the window. Derived from the window's own
    // rows, every subject looks new in every window and the one answer a single
    // run cannot give degrades into a restatement of the subject list.
    const backend = track(open());

    await backend.append(
      run({ run: 'old', commit: 'c0', at: '2026-01-05T10:00:00.000Z' }),
      [observation({ run: 'old', commit: 'c0', at: '2026-01-05T10:00:00.000Z', subject: 'checkout' })],
      [],
    );
    await backend.append(
      run({ run: 'r1', commit: 'c1', at: '2026-02-05T10:00:00.000Z' }),
      [observation({ run: 'r1', commit: 'c1', at: '2026-02-05T10:00:00.000Z', subject: 'checkout' })],
      [],
    );
    await backend.append(
      run({ run: 'r2', commit: 'c2', at: '2026-02-10T10:00:00.000Z' }),
      [observation({ run: 'r2', commit: 'c2', at: '2026-02-10T10:00:00.000Z', subject: 'settings' })],
      [],
    );

    const reach = await reachFrom(backend, 'shop', 'Button', { since: '2026-02-01T00:00:00.000Z' });
    expect(reach.subjects).toEqual(['checkout', 'settings']);
    expect(reach.arrived).toEqual(['settings']);
    expect(reach.omittedSubjects).toBe(0);
  });

  it('compares a window as instants, so a row from another offset is not dropped', async () => {
    // ISO-8601 sorts lexically only while every timestamp shares one offset. A
    // store fed by CI jobs in two regions and compared as text silently excludes
    // one region — a drift total that is quietly too small.
    const backend = track(open());
    const at = '2026-03-01T00:00:00.000-05:00'; // 05:00Z, but sorts before "…T04:00Z"

    await backend.append(run({ at }), [observation({ at })], [token({ at })]);

    const inside = await backend.observationsOf({
      project: 'shop',
      component: 'Button',
      since: '2026-03-01T04:00:00.000Z',
    });
    expect(inside.rows).toHaveLength(1);
    // And the stored text is returned unchanged, not a normalized rewrite of it.
    expect(inside.rows[0]?.at).toBe(at);
  });

  it('answers `current` with the newest row per scope and nothing older', async () => {
    // The read a run makes before it writes. Anything older than the latest in a
    // scope is not a previous hash — it is a hash the project has already moved
    // away from, and comparing against it re-records a change that already
    // happened.
    const backend = track(open());
    await backend.append(run(), [observation({ hash: 'h-1' as Digest })], []);
    await backend.append(
      run({ run: 'run-2', commit: 'bbbb', at: '2026-03-02T10:00:00.000Z' }),
      [
        observation({
          run: 'run-2',
          commit: 'bbbb',
          at: '2026-03-02T10:00:00.000Z',
          hash: 'h-2' as Digest,
        }),
      ],
      [],
    );

    const rows = await backend.currentOf({ project: 'shop', subjects: ['checkout'] });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.hash).toBe('h-2');
  });

  it('keeps a scope per band, per profile, and per subject asked about', async () => {
    const backend = track(open());
    await backend.append(
      run(),
      [
        observation({ band: 'structure' }),
        observation({ band: 'style', hash: 'h-style' as Digest }),
        observation({ band: 'structure', profile: 'chromium', hash: 'h-chromium' as Digest }),
        observation({ subject: 'settings', hash: 'h-settings' as Digest }),
      ],
      [],
    );

    const asked = await backend.currentOf({ project: 'shop', subjects: ['checkout'] });
    // Three scopes in `checkout`, and the subject nobody asked about stays out:
    // a row from another subject that happened to match would suppress a real
    // change.
    expect(asked).toHaveLength(3);
    expect(asked.every((row) => row.subject === 'checkout')).toBe(true);

    const both = await backend.currentOf({ project: 'shop', subjects: ['checkout', 'settings'] });
    expect(both).toHaveLength(4);
    expect(await backend.currentOf({ project: 'shop', subjects: [] })).toEqual([]);
  });

  it('keeps two projects apart when a query is scoped and blends them when it is not', async () => {
    // The unscoped case is not a bug — a single-project deployment needs no scope
    // — but it is the one that silently averages two products together, so it is
    // asserted rather than assumed.
    const backend = track(open());
    await backend.append(run(), [observation()], []);
    await backend.append(
      run({ project: 'admin', run: 'other' }),
      [observation({ project: 'admin', run: 'other', hash: 'h-x' as Digest })],
      [],
    );

    expect((await backend.observationsOf({ project: 'shop', component: 'Button' })).rows).toHaveLength(1);
    expect((await backend.observationsOf({ component: 'Button' })).rows).toHaveLength(2);
  });
});
