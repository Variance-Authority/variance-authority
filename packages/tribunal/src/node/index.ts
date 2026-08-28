/**
 * The service, on a machine somebody owns — a file, a directory and a port.
 *
 * The same review service `./worker` serves on Cloudflare. D1 is SQLite through
 * `node:sqlite`, R2 is a directory through `node:fs`, and the router between them
 * is byte-for-byte the code a Worker runs, because every module above the
 * bindings takes a `D1Like` and an `R2Like` and has never named a runtime.
 *
 * Requires Node 22 for `node:sqlite`, which is why it is its own entrypoint: a
 * Worker importing `@variance-authority/tribunal/worker` must not pull a Node
 * built-in into its bundle to do it.
 *
 * ```ts
 * import { createDirectoryBucket, openDatabase, serveTribunal } from '@variance-authority/tribunal/node';
 * import { createTribunal } from '@variance-authority/tribunal/worker';
 *
 * const db = await openDatabase('variance-tribunal.db');
 * const tribunal = createTribunal({
 *   db,
 *   bucket: createDirectoryBucket('variance-tribunal-objects'),
 *   project: 'todomvc',
 *   ingestToken: process.env.INGEST_TOKEN!,
 *   reviewToken: process.env.REVIEW_TOKEN!,
 * });
 *
 * await serveTribunal({
 *   tribunal,
 *   host: '127.0.0.1',
 *   port: 7789,
 *   authorize: () => 'review',
 *   tokens: { ingest: process.env.INGEST_TOKEN!, review: process.env.REVIEW_TOKEN! },
 * });
 * ```
 *
 * Or run `variance-authority-tribunal` and configure it with an environment —
 * [`bin.ts`](./bin.ts) is that program, and the policy it applies is written out
 * there rather than assumed here.
 */

export { createDirectoryBucket, type DirectoryBucket } from './bucket.js';
export {
  openDatabase,
  schemaVersionOf,
  wrapSqlite,
  type SqliteDatabase,
  type TribunalDatabase,
} from './database.js';
export {
  MAX_BODY_BYTES,
  createRequestListener,
  serveTribunal,
  type TribunalService,
  type TribunalServiceOptions,
} from './serve.js';
export { reviewPage, uiAsset, type ReviewPageOptions } from './ui-assets.js';
