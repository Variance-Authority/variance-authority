import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { base64Of, type R2Like, type R2ObjectLike } from './bindings.js';
import { wrapSqlite, type SqliteDatabase } from './node/database.js';
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

/**
 * A database with the schema already applied, and a way to let go of it.
 *
 * The same shape [`node/database.ts`](./node/database.ts) hands a running
 * service — this is that adapter, over `':memory:'`, with the schema applied
 * unconditionally because a fresh in-memory file is never anything else.
 */
export type SqliteD1 = SqliteDatabase;

/**
 * A `D1Like` over `node:sqlite`, with the schema already applied.
 *
 * Deliberately not its own implementation. The wrapper is
 * {@link wrapSqlite}, the one an operator's service runs, so a test that passes
 * here is a test of the shipped adapter rather than of a second one written to
 * agree with it. What differs is only the lifecycle: this applies `SCHEMA`
 * outright, where `openDatabase` has to tell a fresh file from a deployed one.
 *
 * A path may be passed for a test that wants a file it can reopen; `':memory:'`
 * is the default and disappears with the handle.
 */
export async function createSqliteD1(path = ':memory:'): Promise<SqliteD1> {
  const database = new Database(path);
  const db = wrapSqlite(database);
  await applySchema(db);
  return db;
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
