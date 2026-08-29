import { createRequire } from 'node:module';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { D1Like, D1PreparedLike, D1Value } from '../bindings.js';
import { INITIAL_VERSION, MIGRATIONS, SCHEMA_VERSION, applySchema } from '../schema.js';

/**
 * D1, as a file on a disk somebody owns.
 *
 * D1 *is* SQLite, so this is an adapter rather than a port: the same `SCHEMA`,
 * the same indexes, the same append-only triggers and the same `ON CONFLICT`
 * clauses execute here, through `node:sqlite`, that a Worker executes through the
 * platform. Nothing above this file knows which one it got — `review.ts`,
 * `store.ts` and `history.ts` take a {@link D1Like} and have never named a
 * runtime.
 *
 * The double in [`testing.ts`](../testing.ts) is this same wrapper over
 * `':memory:'`. That is deliberate and it is the point: the adapter an operator
 * deploys is the adapter the suite runs, so a test that passes is a test of the
 * shipped thing rather than of a paraphrase of it.
 *
 * ## What this does that the Worker cannot
 *
 * **It migrates on open.** A Worker must not — `applySchema` is documented as the
 * operator's to call, because a handler that migrates on first use migrates
 * concurrently under load and D1 has no advisory lock to serialize it with. A
 * single process opening a single file at startup has neither problem: it holds
 * the file, it is not yet serving, and `BEGIN IMMEDIATE` is a real lock. So the
 * one piece of ceremony a Cloudflare deployment cannot avoid is one this
 * deployment does not have.
 *
 * **It refuses a database from the future.** A file at a `schema_version` this
 * build has never heard of was written by a newer build, and the columns it would
 * read are the ones it does not know are there. Opening it read-write is how a
 * downgrade quietly writes rows the newer build then misreads.
 */

const { DatabaseSync: Database } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

export interface SqliteDatabase extends D1Like {
  /** Ends the process's hold on the file. `':memory:'` disappears with it. */
  close(): void;
}

export interface TribunalDatabase extends SqliteDatabase {
  /** Where it actually landed, absolute — printed at startup so it can be found again. */
  readonly path: string;
  /** The version the file is at once {@link openDatabase} has returned. */
  readonly version: number;
}

/**
 * Open the file, bring it to {@link SCHEMA_VERSION}, and hand back a `D1Like`.
 *
 * Fresh file, deployed file and half-upgraded file are three cases and this is
 * the only place that distinguishes them; every caller downstream gets a
 * database at the current version or an exception with a sentence in it.
 */
export async function openDatabase(path: string): Promise<TribunalDatabase> {
  const database = new Database(path);

  // WAL, because a reviewer reading a build while CI posts one is the ordinary
  // case and rollback-journal SQLite blocks readers behind that writer.
  // `busy_timeout` is the other half: two writers now wait rather than one
  // failing instantly with SQLITE_BUSY.
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA foreign_keys = ON');

  const db = wrapSqlite(database);
  const version = await migrate(db);
  return Object.assign(db, { path, version });
}

/** The version a file is at, or `null` for a database with no schema yet. */
export async function schemaVersionOf(db: D1Like): Promise<number | null> {
  const table = await db
    .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'schema_version'`)
    .first<{ readonly name: string }>();
  if (table === null) return null;

  const row = await db.prepare('SELECT version FROM schema_version').first<{ readonly version: number }>();
  if (row === null || typeof row.version !== 'number') {
    throw new Error(
      'this database has a `schema_version` table with no version in it. That is not a state ' +
        'any migration here can produce, so the file was edited by something else; point ' +
        '`--database` at a new path rather than letting a repair guess what the rest of the rows mean',
    );
  }
  return row.version;
}

async function migrate(db: SqliteDatabase): Promise<number> {
  const version = await schemaVersionOf(db);

  if (version === null) {
    await applySchema(db);
    return SCHEMA_VERSION;
  }

  if (version === SCHEMA_VERSION) return version;

  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `this database is at schema version ${version} and this build knows ${SCHEMA_VERSION}. It ` +
        'was written by a newer @variance-authority/tribunal, and the columns that build added ' +
        'are the ones this one does not know to write. Upgrade the service rather than ' +
        'downgrading the record',
    );
  }

  if (version < INITIAL_VERSION) {
    db.close();
    throw new Error(
      `this database is at schema version ${version}, which predates the first published shape ` +
        `(${INITIAL_VERSION}). There is no step from it, because there was never a released ` +
        'build that wrote it',
    );
  }

  // Each step ends by writing the version it lands on, and each runs in its own
  // batch — so an interrupted upgrade leaves the file at a version whose shape it
  // actually has, and the next open resumes from there rather than replaying a
  // step that already landed.
  for (const step of MIGRATIONS.slice(version - INITIAL_VERSION)) {
    await db.batch(step.map((statement) => db.prepare(statement)));
  }
  return SCHEMA_VERSION;
}

/**
 * The wrapper itself: `node:sqlite` in, {@link D1Like} out.
 *
 * The one behavioural difference from a `DatabaseSync` used directly is that
 * `first` answers `null` where `get` answers `undefined`. That is not cosmetic:
 * `null` is D1's "no row", the whole store distinguishes it from a failure, and a
 * wrapper that returned `undefined` would let a `=== null` check silently stop
 * being true.
 */
export function wrapSqlite(database: DatabaseSync): SqliteDatabase {
  const statement = (sql: string, values: readonly D1Value[]): D1PreparedLike => ({
    bind: (...bound: readonly D1Value[]) => statement(sql, bound),
    async first<Row>(): Promise<Row | null> {
      const row = database.prepare(sql).get(...inputs(values));
      return row === undefined ? null : (row as Row);
    },
    async all<Row>(): Promise<{ readonly results: readonly Row[] }> {
      return { results: database.prepare(sql).all(...inputs(values)) as Row[] };
    },
    async run(): Promise<unknown> {
      return database.prepare(sql).run(...inputs(values));
    },
  });

  return {
    prepare: (sql: string) => statement(sql, []),

    /**
     * All of them, or none of them.
     *
     * D1 documents `batch` as running inside an implicit transaction that rolls
     * back on any failure, and the history backend's atomicity requirement rests
     * entirely on that. Here it is a real `BEGIN IMMEDIATE`, so a caller that
     * expects a half-written run to leave nothing behind is getting the property
     * rather than the platform's description of it.
     */
    async batch(statements: readonly D1PreparedLike[]): Promise<unknown> {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results: unknown[] = [];
        for (const prepared of statements) results.push(await prepared.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    close: () => database.close(),
  };
}

/**
 * `node:sqlite` accepts `null`, numbers, strings and `Uint8Array`; D1 speaks
 * `ArrayBuffer`. One conversion, in the one place the two vocabularies meet.
 */
function inputs(values: readonly D1Value[]): SQLInputValue[] {
  return values.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value));
}
