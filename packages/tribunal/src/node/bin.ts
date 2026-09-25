#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createDirectoryBucket } from './bucket.js';
import { openDatabase, type TribunalDatabase } from './database.js';
import { serveTribunal, type TribunalService } from './serve.js';
import { createTribunal } from '../worker.js';

/**
 * `variance-authority-tribunal` — the thing the operator runs.
 *
 * A process, a port, a file, a directory and two tokens. The same review
 * service a Cloudflare deployment serves, with SQLite where D1 was and a
 * directory where R2 was; every route, every refusal and every status code is
 * the same code.
 *
 * Configuration is environment variables rather than flags, matching
 * [`server`](../../../server/src/bin.ts) — a service is started by a supervisor,
 * a unit file or a container, and all three pass an environment.
 *
 * ## The three things this refuses
 *
 * **No tokens, no service.** Inherited from `createTribunal` rather than
 * re-implemented: two bearer tokens, sixteen characters each, and not the same
 * string. The refusal is the constructor's and it is quoted straight to stderr.
 *
 * **A project, named.** There is no default. An invented one puts two
 * repositories' baselines in one namespace and the first symptom is a mass
 * `changed` — the argument is the package's, and `worker-entry` only falls back
 * to `default` because a Worker environment has nobody to ask. A person typing a
 * command does.
 *
 * **Loopback unless somebody typed otherwise.** Exposure is a decision, not an
 * accident of a bind address. And on a non-loopback bind the **review surface is
 * not served at all** — see {@link authorizeFor}, which is the one piece of
 * policy this file owns.
 */

export const PORT_VARIABLE = 'VARIANCE_TRIBUNAL_PORT';
export const HOST_VARIABLE = 'VARIANCE_TRIBUNAL_HOST';
export const DATABASE_VARIABLE = 'VARIANCE_TRIBUNAL_DB';
export const STORAGE_VARIABLE = 'VARIANCE_TRIBUNAL_STORAGE';
export const PROJECT_VARIABLE = 'VARIANCE_TRIBUNAL_PROJECT';
export const INGEST_TOKEN_VARIABLE = 'VARIANCE_TRIBUNAL_INGEST_TOKEN';
export const REVIEW_TOKEN_VARIABLE = 'VARIANCE_TRIBUNAL_REVIEW_TOKEN';
export const RETENTION_VARIABLE = 'VARIANCE_TRIBUNAL_RETENTION_DAYS';
export const REVIEWER_VARIABLE = 'VARIANCE_TRIBUNAL_REVIEWER';
export const TRUST_NETWORK_VARIABLE = 'VARIANCE_TRIBUNAL_TRUST_NETWORK';

const DEFAULT_PORT = 7789;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_DATABASE = 'variance-tribunal.db';
const DEFAULT_STORAGE = 'variance-tribunal-objects';

/** Addresses that can only be reached from the machine the process is on. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export interface TribunalConfig {
  readonly port: number;
  readonly host: string;
  /** Absolute, so the startup line names the file rather than a guess. */
  readonly database: string;
  /** Absolute, for the same reason. */
  readonly storage: string;
  readonly project: string;
  readonly ingestToken: string;
  readonly reviewToken: string;
  readonly retentionDays?: number;
  readonly reviewer: string;
  /**
   * Whether the socket is reachable only from this machine.
   *
   * Derived rather than configured: it is a fact about the bind address, and a
   * setting that could disagree with the address would be a setting that lies.
   */
  readonly loopback: boolean;
}

/**
 * Read the configuration, or explain exactly which variable is wrong.
 *
 * Pure and exported, so every refusal below is testable without binding a port.
 * A rule that can only be exercised by starting a process is a rule that gets
 * tested once, by hand, before it is weakened.
 */
export function readConfig(env: Readonly<Record<string, string | undefined>>): TribunalConfig {
  // The project scopes every row and every object key, so one deployment can
  // serve several repositories without their `story:card` colliding. There is no
  // default on purpose: an invented one puts two projects' baselines in one
  // namespace, and the first symptom is every subject reporting `changed` at once.
  const project = (env[PROJECT_VARIABLE] ?? '').trim();
  if (project === '') {
    throw new Error(
      `${PROJECT_VARIABLE} is not set. It scopes every row and every object key, and has no default.`,
    );
  }

  const host = orDefault(env[HOST_VARIABLE], DEFAULT_HOST);
  const loopback = LOOPBACK.has(host);
  // This service has bearer tokens and no accounts, no TLS and no rate limit, so
  // a network bind is a decision somebody should have typed. The review surface
  // is not served on one, because nothing would stand between it and an approve
  // button on the internet.
  if (!loopback && orDefault(env[TRUST_NETWORK_VARIABLE], '') === '') {
    throw new Error(
      `${HOST_VARIABLE}=${host} is not loopback; set ${TRUST_NETWORK_VARIABLE}=1 to allow it. ` +
        'The review UI is not served on a network bind: put the Next.js adapter behind your own ' +
        'sign-in, or stay on loopback behind a reverse proxy that authenticates.',
    );
  }

  const rawPort = env[PORT_VARIABLE];
  const port = rawPort === undefined || rawPort === '' ? DEFAULT_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(
      `${PORT_VARIABLE} must be a whole number between 0 and 65535; received "${rawPort ?? ''}"`,
    );
  }

  const rawRetention = env[RETENTION_VARIABLE];
  const retentionDays = rawRetention === undefined || rawRetention === '' ? undefined : Number(rawRetention);
  if (retentionDays !== undefined && (!Number.isFinite(retentionDays) || retentionDays <= 0)) {
    throw new Error(
      `${RETENTION_VARIABLE} must be a positive number of days; received "${rawRetention ?? ''}". ` +
        'Leave it unset for the package default rather than passing zero, which would sweep ' +
        'every build the first time anyone asked.',
    );
  }

  return {
    port,
    host,
    loopback,
    database: resolve(orDefault(env[DATABASE_VARIABLE], DEFAULT_DATABASE)),
    storage: resolve(orDefault(env[STORAGE_VARIABLE], DEFAULT_STORAGE)),
    project,
    // Passed through unvalidated: `createTribunal` refuses a short token and two
    // identical ones, and a second copy of that rule here is a second place for
    // it to be relaxed.
    ingestToken: env[INGEST_TOKEN_VARIABLE] ?? '',
    reviewToken: env[REVIEW_TOKEN_VARIABLE] ?? '',
    ...(retentionDays === undefined ? {} : { retentionDays }),
    reviewer: orDefault(env[REVIEWER_VARIABLE], defaultReviewer()),
  };
}

/**
 * The one piece of policy this file owns: who is allowed what.
 *
 * `createTribunalRoutes` requires an `authorize` and gives it no default, on the
 * grounds that returning `'review'` for every request would publish an approve
 * button. This is a host writing that function in its own file, where the next
 * person can read it — which is exactly what that refusal asks for.
 *
 * Three rules, in order:
 *
 * 1. **A caller holding a token gets what the token is for.** CI posts with the
 *    ingest token from wherever CI runs. The mount replaces the header before the
 *    Worker sees it, so this is the only place the caller's own bearer is read.
 * 2. **On a loopback bind, a caller with no token reviews.** The socket is the
 *    gate: only this machine can reach it, and the person at this machine is the
 *    reviewer. This is what lets the served page work with no credential in it.
 * 3. **On a network bind, no token is no capability** — and the surface is not
 *    served at all, so there is no page to be tricked into carrying one.
 */
export function authorizeFor(config: TribunalConfig): (request: Request) => 'ingest' | 'review' | null {
  return (request: Request) => {
    const bearer = bearerOf(request);
    if (bearer !== null) {
      if (bearer === config.ingestToken) return 'ingest';
      if (bearer === config.reviewToken) return 'review';
      return null;
    }
    return config.loopback ? 'review' : null;
  };
}

function bearerOf(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match === null ? null : (match[1] as string);
}

export interface RunningTribunal extends TribunalService {
  readonly database: TribunalDatabase;
}

/**
 * Open the file, make the directory, bind the port, and say what was done.
 *
 * The startup line names the absolute database path, the absolute object
 * directory, the project, the schema version and the bind address, and names
 * neither token. Everything an operator needs to confirm they configured the
 * right thing, and nothing that turns a shipped log into a credential.
 */
export async function start(
  env: Readonly<Record<string, string | undefined>>,
  write: (line: string) => void = (line) => process.stdout.write(line),
): Promise<RunningTribunal> {
  const config = readConfig(env);
  const database = await openDatabase(config.database);

  let service: TribunalService;
  try {
    const tribunal = createTribunal({
      db: database,
      bucket: createDirectoryBucket(config.storage),
      project: config.project,
      ingestToken: config.ingestToken,
      reviewToken: config.reviewToken,
      ...(config.retentionDays === undefined ? {} : { retentionDays: config.retentionDays }),
    });

    service = await serveTribunal({
      tribunal,
      host: config.host,
      port: config.port,
      authorize: authorizeFor(config),
      tokens: { ingest: config.ingestToken, review: config.reviewToken },
      ui: config.loopback,
      reviewer: config.reviewer,
    });
  } catch (error) {
    // A refused token or a taken port leaves the database open otherwise, holding
    // its lock against the process the operator is about to start instead.
    database.close();
    throw error;
  }

  write(
    `variance-authority tribunal listening on ${service.url}\n` +
      `  project:  ${config.project}\n` +
      `  database: ${config.database} (schema version ${database.version})\n` +
      `  objects:  ${config.storage}\n` +
      `  review:   ${
        config.loopback
          ? `served at ${service.url} — this bind is reachable only from this machine`
          : `not served: ${HOST_VARIABLE} is a network address. The JSON API is up and wants a bearer token`
      }\n` +
      `  auth:     bearer tokens from ${INGEST_TOKEN_VARIABLE} and ${REVIEW_TOKEN_VARIABLE}\n`,
  );

  return {
    ...service,
    database,
    async close(): Promise<void> {
      await service.close();
      database.close();
    },
  };
}

function orDefault(value: string | undefined, fallback: string): string {
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

/**
 * Who a decision is recorded as when nobody said.
 *
 * There are no accounts here — a decision carries a name, and the name should be
 * a person rather than the word "reviewer". The OS knows one; `userInfo` throws
 * on a host with no passwd entry, which some containers are.
 */
function defaultReviewer(): string {
  try {
    return userInfo().username;
  } catch {
    return 'reviewer';
  }
}

/**
 * A flag is not a way to configure this, and saying so is the whole point.
 *
 * `process.argv` was read by nothing here, which is defensible — configuration
 * is an environment, for the reason on the module — and silently accepting the
 * arguments of the configuration this *is not* is not. `--database ./x.db` on a
 * process that only reads {@link DATABASE_VARIABLE} starts a service against a
 * fresh empty file in the working directory, reports success, and prints a
 * startup line that reads as confirmation because it is honestly reporting what
 * the process did. The operator's next move is to ask why their builds are
 * gone.
 *
 * So: refuse, and name the variable the flag was reaching for. Returning the
 * usage text rather than writing it keeps this pure — the refusals above are
 * testable without binding a port and this one is no different.
 */
export function readArguments(argv: readonly string[]): string | null {
  if (argv.length === 0) return null;
  if (argv.includes('--help') || argv.includes('-h')) return USAGE;

  const given = argv[0] as string;
  const flag = given.split('=')[0] as string;
  const variable = AS_VARIABLE[flag];

  // Configured by environment, because a service is started by a supervisor, a
  // unit file or a container, and all three pass one.
  throw new Error(
    variable === undefined
      ? `this service takes no arguments and received \`${given}\`; it is configured by environment.\n\n${USAGE}`
      : `\`${flag}\` is ${variable}; this service is configured by environment, not flags.\n\n${USAGE}`,
  );
}

/** The flags somebody reaches for, and what each one actually is. */
const AS_VARIABLE: Readonly<Record<string, string>> = {
  '--db': DATABASE_VARIABLE,
  '--database': DATABASE_VARIABLE,
  '--objects': STORAGE_VARIABLE,
  '--storage': STORAGE_VARIABLE,
  '--port': PORT_VARIABLE,
  '--host': HOST_VARIABLE,
  '--project': PROJECT_VARIABLE,
  '--retention': RETENTION_VARIABLE,
  '--reviewer': REVIEWER_VARIABLE,
};

/** Every variable, in the order somebody sets them. */
const VARIABLES: readonly (readonly [string, string])[] = [
  [PROJECT_VARIABLE, 'required — scopes every row and every object key'],
  [INGEST_TOKEN_VARIABLE, 'required — what CI pushes with'],
  [REVIEW_TOKEN_VARIABLE, 'required — what a person decides with'],
  [DATABASE_VARIABLE, `the SQLite file (default ${DEFAULT_DATABASE})`],
  [STORAGE_VARIABLE, `where images are kept (default ${DEFAULT_STORAGE})`],
  [PORT_VARIABLE, `default ${DEFAULT_PORT}`],
  [HOST_VARIABLE, `default ${DEFAULT_HOST}; a network bind serves no review page`],
  [TRUST_NETWORK_VARIABLE, 'confirms a network bind was meant'],
  [RETENTION_VARIABLE, 'days after which a build is swept'],
  [REVIEWER_VARIABLE, 'the name a decision is recorded under'],
];

/**
 * Built rather than typed out, and padded from the names themselves: a
 * hand-aligned block goes crooked the first time one of them is renamed.
 */
const USAGE = ((widest: number) =>
  [
    'variance-authority-tribunal — a process, a port, a file and two tokens.',
    '',
    'Configured by environment. There are no flags.',
    '',
    ...VARIABLES.map(([name, what]) => `  ${name.padEnd(widest)}  ${what}`),
    '',
  ].join('\n'))(Math.max(...VARIABLES.map(([name]) => name.length)));

async function main(): Promise<void> {
  let service: RunningTribunal;
  try {
    const usage = readArguments(process.argv.slice(2));
    if (usage !== null) {
      process.stdout.write(usage);
      return;
    }
    service = await start(process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
    return;
  }

  // Both signals close the database rather than letting the process die with a
  // write in flight. SQLite recovers from that, but an operator reading a WAL
  // recovery message has no way to know nothing was lost.
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
 * A package manager installs a bin as a symlink — `node_modules/.bin/variance-authority-tribunal`
 * pointing here — so `process.argv[1]` is the link and `import.meta.url` is its
 * target. Compared as written they never match, and the guard below would then
 * skip `main` and let the process exit 0 without serving anything.
 */
function isProgram(entry: string): boolean {
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (process.argv[1] !== undefined && isProgram(process.argv[1])) {
  await main();
}
