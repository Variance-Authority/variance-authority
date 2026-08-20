import { createRequire } from 'node:module';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { base64Of, type D1Like, type D1PreparedLike, type D1Value, type R2Like, type R2ObjectLike } from './bindings.js';
import { applySchema } from './schema.js';

/**
 * Cloudflare, doubled — and doubled at the level where the doubling is honest.
 *
 * A fake that answered queries from a `Map` would test this package's control
 * flow and nothing else: the schema, the indexes, the append-only triggers, the
 * `ON CONFLICT` clause and every `ORDER BY` would be strings nobody executed.
 * D1 *is* SQLite, and `node:sqlite` is already a dependency of
 * [`@variance-authority/server`](../../server), so the double below runs the real
 * statements against a real engine. What the tests then verify is the SQL, not a
 * paraphrase of it.
 *
 * **What it does not verify** is Cloudflare. Request limits, object-size
 * ceilings, quotas, consistency between two Workers writing at once, and whether
 * D1's `batch` is transactional in the way this package needs — none of those are
 * measured, here or anywhere else in this repository. They are stated as unmet in
 * [ADR-0023](../../../docs/context/adr/0023-a-service-is-named-for-what-it-is.md) and the checkpoint rather than
 * implied to be fine by a green suite.
 *
 * Exported as `@variance-authority/tribunal/testing` because it is also the
 * thing an operator wants: a way to run their own wiring — their routes, their
 * ingest, their retention settings — in a plain `vitest` process, with no
 * `wrangler`, no container, and no account.
 */

const { DatabaseSync: Database } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

export interface SqliteD1 extends D1Like {
  /** Ends the process's hold on the database. `':memory:'` disappears with it. */
  close(): void;
}

/**
 * A `D1Like` over `node:sqlite`, with the schema already applied.
 *
 * The one behavioural difference from a `DatabaseSync` used directly is that
 * `first` answers `null` where `get` answers `undefined`. That is not cosmetic:
 * `null` is D1's "no row", the whole store distinguishes it from a failure, and a
 * double that returned `undefined` would let a `=== null` check silently stop
 * being true.
 */
export async function createSqliteD1(path = ':memory:'): Promise<SqliteD1> {
  const database = new Database(path);
  const db = wrap(database);
  await applySchema(db);
  return db;
}

function wrap(database: DatabaseSync): SqliteD1 {
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
     * entirely on that. Here it is a real `BEGIN IMMEDIATE`, so a test that
     * expects a half-written run to leave nothing behind is testing the property
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

export interface MemoryR2 extends R2Like {
  /** Every key currently held, sorted. The assertion surface for retention tests. */
  keys(): readonly string[];
  /** Base64 of one object, for a test that wants to compare bytes rather than count them. */
  read(key: string): string | undefined;
  /**
   * Make the next `count` calls of any kind throw.
   *
   * Because "a store failure is never a verdict" is the rule this whole package
   * is arranged around, and a rule with no test that breaks it is a comment.
   */
  fail(message: string, count?: number): void;
}

export function createMemoryR2(): MemoryR2 {
  const objects = new Map<string, ArrayBuffer>();
  let failures = 0;
  let reason = '';

  const check = (): void => {
    if (failures <= 0) return;
    failures -= 1;
    throw new Error(reason);
  };

  const object = (buffer: ArrayBuffer): R2ObjectLike => ({
    arrayBuffer: async (): Promise<ArrayBuffer> => buffer,
  });

  return {
    async get(key: string): Promise<R2ObjectLike | null> {
      check();
      const stored = objects.get(key);
      return stored === undefined ? null : object(stored);
    },
    async head(key: string): Promise<unknown | null> {
      check();
      return objects.has(key) ? { key } : null;
    },
    async put(key: string, value: ArrayBuffer): Promise<unknown> {
      check();
      objects.set(key, value);
      return { key };
    },
    async delete(keys: string | readonly string[]): Promise<unknown> {
      check();
      for (const key of typeof keys === 'string' ? [keys] : keys) objects.delete(key);
      return undefined;
    },

    keys: () => [...objects.keys()].sort(),
    read: (key: string) => {
      const stored = objects.get(key);
      return stored === undefined ? undefined : base64Of(stored);
    },
    fail: (message: string, count = 1): void => {
      reason = message;
      failures = count;
    },
  };
}
