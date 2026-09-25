#!/usr/bin/env node
import { resolve } from 'node:path';
import process from 'node:process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSqliteBackend } from './backend-sqlite.js';
import { serveHistory, type HistoryService } from './http.js';

/**
 * `variance-authority-server` — the thing the operator runs.
 *
 * Nothing in this repository runs it for anyone and no instance is shared between
 * operators (spec 0002). What that buys is a very short configuration surface: a
 * port, a file, and a token. What it costs is that every mistake in those three
 * is the operator's, made once, at 3am, and never noticed again — so this file
 * refuses far more than it defaults.
 *
 * **No token, no service.** The single most important line here. A history
 * service that starts without authentication is worse than one that will not
 * start: it listens, it accepts writes it cannot attribute, it answers every
 * question about an unreleased product's internals, and it does all of that
 * silently and successfully. A process that exits with a sentence gets fixed in a
 * minute; an open one gets fixed after it is found.
 *
 * **Loopback unless told otherwise.** The bind address defaults to `127.0.0.1`
 * for the same reason, one step weaker: exposure should be a decision somebody
 * typed.
 *
 * The database path *is* defaulted, and that is the one convenience taken here —
 * it is printed, absolutely, on startup, because a service quietly writing a
 * history into whatever directory it was launched from is a history nobody can
 * find later.
 */

export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  /** Absolute. Resolved here so the startup line names the file, not a guess. */
  readonly database: string;
  readonly token: string;
}

export const PORT_VARIABLE = 'VARIANCE_HISTORY_PORT';
export const HOST_VARIABLE = 'VARIANCE_HISTORY_HOST';
export const DATABASE_VARIABLE = 'VARIANCE_HISTORY_DB';
export const TOKEN_VARIABLE = 'VARIANCE_HISTORY_TOKEN';

const DEFAULT_PORT = 7788;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_DATABASE = 'variance-history.db';

/**
 * Shortest token the service will start with.
 *
 * A rule the spec does not state, added because the spec's rule — "authentication
 * is a bearer token the operator sets" — is satisfied to the letter by `dev`, and
 * a four-character shared secret on a network port is an open service with a
 * formality in front of it. The threshold is arbitrary; what is not arbitrary is
 * that the failure be visible at startup instead of at breach.
 */
const MINIMUM_TOKEN_LENGTH = 16;

/**
 * Read the configuration, or explain exactly which variable is missing.
 *
 * Pure and exported so the refusals above are testable without binding a port.
 * A rule that can only be exercised by starting a process is a rule that gets
 * tested once, by hand, before it is weakened.
 */
export function readConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const token = env[TOKEN_VARIABLE];

  if (token === undefined || token.trim() === '') {
    throw new Error(
      `${TOKEN_VARIABLE} is not set. The history service will not start without one: an ` +
        'unauthenticated history listens, accepts writes it cannot attribute to any run, and ' +
        'answers every question asked of it — silently and successfully. Set it to a random ' +
        `secret of at least ${MINIMUM_TOKEN_LENGTH} characters, for example the output of ` +
        '`node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"`.',
    );
  }

  if (token.trim().length < MINIMUM_TOKEN_LENGTH) {
    throw new Error(
      `${TOKEN_VARIABLE} is ${token.trim().length} characters long; at least ` +
        `${MINIMUM_TOKEN_LENGTH} are required. A short shared secret on a network port is an ` +
        'open service with a formality in front of it, and the difference is invisible until ' +
        'somebody guesses it.',
    );
  }

  const rawPort = env[PORT_VARIABLE];
  const port = rawPort === undefined || rawPort === '' ? DEFAULT_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(
      `${PORT_VARIABLE} must be a whole number between 0 and 65535; received "${rawPort ?? ''}"`,
    );
  }

  const host = env[HOST_VARIABLE];
  const database = env[DATABASE_VARIABLE];

  return {
    port,
    host: host === undefined || host === '' ? DEFAULT_HOST : host,
    database: resolve(database === undefined || database === '' ? DEFAULT_DATABASE : database),
    token: token.trim(),
  };
}

/**
 * Open the store, bind the port, and say what was done.
 *
 * The startup line names the absolute database path and the bind address and does
 * not name the token. Everything an operator needs to confirm they configured the
 * right thing, and nothing that turns a shipped log into a credential.
 */
export async function start(
  env: Readonly<Record<string, string | undefined>>,
  write: (line: string) => void = (line) => process.stdout.write(line),
): Promise<HistoryService> {
  const config = readConfig(env);
  const backend = createSqliteBackend({ path: config.database });

  let service: HistoryService;
  try {
    service = await serveHistory({
      backend,
      token: config.token,
      port: config.port,
      host: config.host,
    });
  } catch (error) {
    // The port is the thing most likely to be taken. Leaving the database open
    // after failing to bind would hold its lock against the process the operator
    // is about to start instead.
    await backend.close();
    throw error;
  }

  write(
    `variance-authority history service listening on ${service.url}\n` +
      `  database: ${config.database}\n` +
      `  storage:  node:sqlite (Node ${process.versions.node})\n` +
      `  auth:     bearer token from ${TOKEN_VARIABLE}\n`,
  );

  return {
    url: service.url,
    port: service.port,
    async close(): Promise<void> {
      await service.close();
      await backend.close();
    },
  };
}

/**
 * Run only when invoked as the executable.
 *
 * Without the guard, importing this module for its `readConfig` — which the tests
 * do — would bind a port as a side effect of a type-checking exercise.
 */
async function main(): Promise<void> {
  let service: HistoryService;
  try {
    service = await start(process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
    return;
  }

  // SIGINT and SIGTERM both close the database rather than letting the process
  // die with a write in flight. SQLite would recover from that, but the operator
  // reading a WAL recovery message has no way to know nothing was lost.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void service.close().then(
        () => process.exit(0),
        (error: unknown) => {
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
          process.exit(1);
        },
      );
    });
  }
}

/**
 * Whether `entry` names this file, following links on both sides.
 *
 * A package manager installs a bin as a symlink — `node_modules/.bin/variance-authority-server`
 * pointing here — so `process.argv[1]` is the link and `import.meta.url` is its
 * target. Compared as written they never match, and the guard below then skips
 * `main` and lets the process exit 0 without serving anything.
 */
function isProgram(entry: string): boolean {
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const entry = process.argv[1];
if (entry !== undefined && isProgram(entry)) {
  void main();
}
