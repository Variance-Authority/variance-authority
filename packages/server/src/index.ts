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
 *
 * This entrypoint is the **contract and the socket**: what a backend has to be,
 * the arithmetic that turns rows into answers, and the service in front of it.
 * The shipped backend is `@variance-authority/server/sqlite`, one import away,
 * because `node:sqlite` is not a free requirement — an operator backing this with
 * Postgres implements {@link HistoryBackend} and should never load it. The
 * process that composes the two — environment in, listening socket out — is
 * `@variance-authority/server/bin`, which is also what the `variance-authority-
 * server` executable runs.
 */

export type {
  AreaQuery,
  BackendQuery,
  ComponentWindowQuery,
  HistoryBackend,
  ReachRows,
  Slice,
  SubjectsQuery,
  SubjectWindowQuery,
  TokenWindowQuery,
  WindowQuery,
} from './backend.js';
export {
  HistoryWriteConflict,
  churnFrom,
  createBackedStore,
  currentFrom,
  flakinessFrom,
  journeyFrom,
  lastChangedFrom,
  reachFrom,
} from './backend.js';

export type { HistoryService, HistoryServiceOptions } from './http.js';
export { serveHistory } from './http.js';
