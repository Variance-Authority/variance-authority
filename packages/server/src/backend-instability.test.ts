import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunRecord } from '@variance-authority/history';
import { createSqliteBackend } from './backend-sqlite.js';
import type { HistoryBackend } from './backend.js';

/**
 * Storing that a subject did not read the same way twice.
 *
 * Its own file rather than another section of `backend-sqlite.test.ts`, because
 * the rules being asserted are about a different thing: an occurrence is an
 * *event*, not a state, so the write-only-on-movement rule that governs
 * observations is deliberately absent here, and what has to survive instead is
 * the pair of absences — a run that never said what it examined, and a reading
 * that could not be resolved to a component. Both are `NULL`, and both become a
 * wrong number the moment somebody reads them as `false` and `""`.
 *
 * The migration test lives here too: version 2 is exactly this table plus that
 * column, so the thing it must not cost anybody is exactly this file's subject.
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


describe('instability', () => {
  it('records an occurrence per firing, and keeps a run that swept apart from one that did not', async () => {
    // Instabilities have no write-only-on-movement rule: an occurrence is an
    // event and every firing is what a rate counts. What the rate divides by is
    // the sweep flag, which is why it has to survive the round trip.
    const backend = track(open());
    await backend.append(run({ swept: true }), [], [], [
      {
        project: 'shop',
        subject: 'checkout',
        component: 'Clock',
        band: 'content',
        profile: 'jsdom',
        commit: 'aaaa',
        run: 'run-1',
        at: '2026-03-01T10:00:00.000Z',
      },
    ]);
    await backend.append(
      run({ run: 'run-2', at: '2026-03-02T10:00:00.000Z' }),
      [],
      [],
      [],
    );

    const rows = await backend.instabilitiesOf({ project: 'shop', subject: 'checkout' });
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.component).toBe('Clock');

    const runs = await backend.runsIn({ project: 'shop' });
    // Absent is not false: the second run never said what it examined, and
    // storing that as "did not sweep" would invent a denominator.
    expect(runs.rows.map((entry) => entry.swept)).toEqual([true, undefined]);
  });

  it('stores an unnamed instability as unnamed rather than as a component called nothing', async () => {
    const backend = track(open());
    await backend.append(run(), [], [], [
      {
        project: 'shop',
        subject: 'checkout',
        profile: 'jsdom',
        commit: 'aaaa',
        run: 'run-1',
        at: '2026-03-01T10:00:00.000Z',
      },
    ]);

    const rows = await backend.instabilitiesOf({ project: 'shop', subject: 'checkout' });
    expect(rows.rows[0]).not.toHaveProperty('component');
    expect(rows.rows[0]).not.toHaveProperty('band');
  });

  it('refuses to rewrite or delete an occurrence, like every other row here', async () => {
    // A deleted occurrence is how a flake that was fixed becomes a flake that
    // never happened — and the rate somebody read last week stops being
    // reproducible.
    const directory = scratch();
    const path = join(directory, 'history.db');
    const backend = track(open(path));
    await backend.append(run(), [], [], [
      {
        project: 'shop',
        subject: 'checkout',
        profile: 'jsdom',
        commit: 'aaaa',
        run: 'run-1',
        at: '2026-03-01T10:00:00.000Z',
      },
    ]);
    await backend.close();
    backends.pop();

    const raw = new Database(path);
    expect(() => raw.exec('DELETE FROM instabilities')).toThrow(/append-only/);
    expect(() => raw.exec("UPDATE instabilities SET subject = 'other'")).toThrow(/append-only/);
    raw.close();
  });

  it('migrates a version-1 database instead of refusing the operator their history', async () => {
    // The first version of the schema file said an older database is refused
    // *because no migration exists yet*. One does now, and refusing instead would
    // tell an operator whose only copy of their history is that file to delete it.
    const directory = scratch();
    const path = join(directory, 'v1.db');

    const raw = new Database(path);
    raw.exec(`
      CREATE TABLE runs (
        project TEXT NOT NULL, run TEXT NOT NULL, "commit" TEXT NOT NULL,
        profile TEXT NOT NULL, at TEXT NOT NULL, at_ms INTEGER NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX runs_identity ON runs (project, run, profile);
      INSERT INTO runs VALUES ('shop', 'old', 'aaaa', 'jsdom', '2026-01-01T00:00:00.000Z', 1767225600000);
      PRAGMA user_version = 1;
    `);
    raw.close();

    const backend = track(open(path));

    // The old row is still there, and the new questions are answerable.
    const runs = await backend.runsIn({ project: 'shop' });
    expect(runs.rows.map((entry) => entry.run)).toEqual(['old']);
    expect(runs.rows[0]?.swept).toBeUndefined();
    expect((await backend.instabilitiesOf({ project: 'shop', subject: 'checkout' })).rows).toEqual(
      [],
    );
  });
});
