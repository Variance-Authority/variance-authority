/**
 * `@variance-authority/server` — the storage, and a port in front of it.
 *
 * The half of spec 0002 that has state. `@variance-authority/history` holds the
 * contract, the drift arithmetic, and a client, and holds no storage at all; this
 * package holds a database and a socket and holds no arithmetic at all. The line
 * between them is what makes the record a *service*: two branches observing
 * different hashes for one key are two rows, and nothing here has to resolve a
 * merge, because nothing here is a file anybody reviews.
 *
 * It is first-party and self-hosted, and both words are load-bearing. The
 * operator runs it — a process, a port, and a token they set. Nothing in this
 * repository runs it for anyone, no instance is shared between operators, and
 * everything it stores was produced by the operator's own runs. It neither
 * reaches out nor accepts a write it cannot attribute to its configured token.
 */

export type {
  AreaQuery,
  BackendQuery,
  ComponentWindowQuery,
  HistoryBackend,
  ReachRows,
  Slice,
  TokenWindowQuery,
  WindowQuery,
} from './backend.js';
export {
  HistoryWriteConflict,
  churnFrom,
  createBackedStore,
  journeyFrom,
  lastChangedFrom,
  reachFrom,
} from './backend.js';

export type { SqliteBackendOptions } from './backend-sqlite.js';
export { SCHEMA_VERSION, createSqliteBackend } from './backend-sqlite.js';

export type { HistoryService, HistoryServiceOptions } from './http.js';
export { serveHistory } from './http.js';

export type { ServerConfig } from './bin.js';
export {
  DATABASE_VARIABLE,
  HOST_VARIABLE,
  PORT_VARIABLE,
  TOKEN_VARIABLE,
  readConfig,
  start,
} from './bin.js';
