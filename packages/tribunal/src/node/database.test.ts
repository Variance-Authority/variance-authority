import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INITIAL, INITIAL_VERSION, MIGRATIONS, SCHEMA_VERSION } from '../schema.js';
import { openDatabase, schemaVersionOf, type TribunalDatabase } from './database.js';

// The same `createRequire` hop `database.ts` makes: `node:sqlite` is a built-in
// that vitest's resolver does not carry, and a bare `import` of it fails to load
// under the test transform rather than at runtime.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void };
};

/**
 * The upgrade path, exercised on files rather than argued about.
 *
 * [Spec 0021](../../../../docs/specs/0021-tribunal-on-a-real-deployment.md) names
 * migrating a database that already has rows as one of four things never done.
 * On Cloudflare that stays true until somebody deploys; on a file it is a test,
 * and the arithmetic being checked — step `i` lands on `INITIAL_VERSION + i + 1` —
 * is the same arithmetic `wrangler d1 migrations apply` performs against the
 * generated `.sql` files.
 */

let directory: string;
let open: TribunalDatabase[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tribunal-db-'));
});

afterEach(async () => {
  for (const db of open) {
    try {
      db.close();
    } catch {
      // Already closed by a refusal under test.
    }
  }
  open = [];
  await rm(directory, { recursive: true, force: true });
});

async function openAt(name = 'tribunal.db'): Promise<TribunalDatabase> {
  const db = await openDatabase(join(directory, name));
  open.push(db);
  return db;
}

describe('opening a file brings it to the current version', () => {
  it('creates the schema in a file that had none', async () => {
    const db = await openAt();

    expect(db.version).toBe(SCHEMA_VERSION);
    expect(await schemaVersionOf(db)).toBe(SCHEMA_VERSION);
  });

  it('reopens a database it already created without re-applying the schema', async () => {
    const first = await openAt();
    first.close();

    // `applySchema` fails on the first `CREATE TABLE` when run twice, which is
    // the documented behaviour and exactly what a restart would hit if opening
    // did not distinguish a fresh file from a made one.
    const second = await openAt();
    expect(second.version).toBe(SCHEMA_VERSION);
  });

  it('keeps the rows that were there', async () => {
    const first = await openAt();
    await first
      .prepare('INSERT INTO runs (project, run, "commit", profile, at, at_ms) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('p', 'run-1', 'abc', 'default', '2026-01-01T00:00:00.000Z', 1)
      .run();
    first.close();

    const second = await openAt();
    const row = await second
      .prepare('SELECT run FROM runs')
      .first<{ readonly run: string }>();
    expect(row?.run).toBe('run-1');
  });
});

describe('a database that is behind is stepped forward', () => {
  /** A file at the frozen initial shape — what a deployment made before `changelog` existed holds. */
  async function atInitialVersion(): Promise<string> {
    const path = join(directory, 'old.db');
    const raw = new DatabaseSync(path);
    for (const statement of INITIAL) raw.exec(statement);
    raw.close();
    return path;
  }

  it('applies every step from the version the file is at', async () => {
    const path = await atInitialVersion();

    const db = await openDatabase(path);
    open.push(db);

    expect(db.version).toBe(SCHEMA_VERSION);
    // The table migration 3 → 4 adds. Reading it is the only proof that the step
    // ran; the version number alone is a claim the step could have written without
    // doing anything.
    const changelog = await db
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'changelog'`)
      .first<{ readonly name: string }>();
    expect(changelog?.name).toBe('changelog');
  });

  it('lands on the same shape as a database created fresh', async () => {
    const stepped = await openDatabase(await atInitialVersion());
    const fresh = await openAt('fresh.db');
    open.push(stepped);

    const shapeOf = async (db: typeof fresh): Promise<readonly string[]> => {
      const { results } = await db
        .prepare(`SELECT name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name`)
        .all<{ readonly name: string; readonly sql: string }>();
      return results.map((row) => `${row.name}\n${row.sql}`);
    };

    // The property the whole `INITIAL` + `MIGRATIONS` split exists to hold, and
    // the one nobody can check by reading two files side by side.
    expect(await shapeOf(stepped)).toEqual(await shapeOf(fresh));
  });

  it('has one step per version between the frozen shape and the current one', () => {
    expect(INITIAL_VERSION + MIGRATIONS.length).toBe(SCHEMA_VERSION);
  });
});

describe('a database it cannot account for is refused, not opened', () => {
  it('refuses a file written by a newer build', async () => {
    const db = await openAt();
    await db.prepare('UPDATE schema_version SET version = ?').bind(SCHEMA_VERSION + 1).run();
    db.close();

    await expect(openAt()).rejects.toThrow(/newer @variance-authority\/tribunal/);
  });

  it('refuses a version that predates the first published shape', async () => {
    const db = await openAt();
    await db.prepare('UPDATE schema_version SET version = ?').bind(INITIAL_VERSION - 1).run();
    db.close();

    await expect(openAt()).rejects.toThrow(/predates the first published shape/);
  });

  it('refuses a schema_version table with no row in it', async () => {
    const db = await openAt();
    // The trigger set is append-only for the record; `schema_version` is not part
    // of the record, so this is reachable by anything holding the file.
    await db.prepare('DELETE FROM schema_version').run();
    db.close();

    await expect(openAt()).rejects.toThrow(/no version in it/);
  });
});

describe('the batch is a transaction', () => {
  it('leaves nothing behind when one statement in a batch fails', async () => {
    const db = await openAt();

    await expect(
      db.batch([
        db
          .prepare(
            'INSERT INTO runs (project, run, "commit", profile, at, at_ms) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .bind('p', 'run-1', 'abc', 'default', '2026-01-01T00:00:00.000Z', 1),
        db.prepare('INSERT INTO runs (project) VALUES (?)').bind('p'),
      ]),
    ).rejects.toThrow();

    const { results } = await db.prepare('SELECT run FROM runs').all<{ readonly run: string }>();
    expect(results).toEqual([]);
  });
});
