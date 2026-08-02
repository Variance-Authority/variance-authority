import { createRequire } from 'node:module';
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite';
import { profileById, type Digest, type ProfileId } from '@variance-authority/core';
import {
  BANDS,
  type Band,
  type Observation,
  type RunRecord,
  type TokenValue,
} from '@variance-authority/history';
import {
  HistoryWriteConflict,
  type AreaQuery,
  type BackendQuery,
  type ComponentWindowQuery,
  type HistoryBackend,
  type ReachRows,
  type Slice,
  type TokenWindowQuery,
  type WindowQuery,
} from './backend.js';

/**
 * SQLite, reached through exactly one file.
 *
 * `node:sqlite` is marked experimental on Node 22 and prints a warning on import.
 * That is not a reason to avoid it — it is the reason this module exists as the
 * only place that names it. A self-hosted service that requires a native build to
 * install is a service nobody installs, and "a single file and a port" is the
 * whole operational burden this deployment shape is trying to keep (spec 0002).
 * When the module's API moves, or when one file stops being enough, the blast
 * radius is this file and the `HistoryBackend` interface holds the rest still.
 *
 * Everything below is append-only, and that is enforced by the database rather
 * than by the code above it. `UPDATE` and `DELETE` triggers abort. The reason is
 * the argument the whole store rests on: two branches observing different hashes
 * for one key are two rows, not a conflict, and the moment anything is allowed to
 * overwrite a row the store acquires the merge problem it was built to escape.
 *
 * Instants are stored twice — the original text, and its parsed milliseconds.
 * Windows are compared on the number. ISO-8601 sorts lexically only while every
 * timestamp shares one offset, and a store fed by CI jobs in two regions does
 * not; a lexical window drops the other region's rows, and a drift total that is
 * quietly too small is exactly the failure this package exists to prevent.
 */

/**
 * Bumped when the stored shape changes in a way an older build would misread.
 *
 * Kept in `PRAGMA user_version`, which is a single integer in the database header
 * — no table to query, no chance of reading rows before discovering the schema is
 * not the one expected.
 */
export const SCHEMA_VERSION = 1;

/**
 * The module, fetched at runtime rather than imported statically.
 *
 * Because it is experimental, `node:sqlite` is absent from
 * `module.builtinModules` — and every bundler and test runner in this repository
 * decides what to externalize from exactly that list. A static import therefore
 * resolves as if `sqlite` were a package on npm and fails to load, in the test
 * runner rather than in production, which is the worst possible place for it.
 * `createRequire` keeps the reference a runtime one, where a Node builtin
 * belongs. The types are still the real ones: the `import type` above is erased
 * entirely, so nothing here is `any` and a change to the module's API is still a
 * compile error.
 *
 * This is a workaround with an expiry date. When the module leaves experimental
 * status and joins `builtinModules`, these six lines become a plain import.
 */
const { DatabaseSync: Database } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

const SCHEMA = `
CREATE TABLE runs (
  project  TEXT NOT NULL,
  run      TEXT NOT NULL,
  "commit" TEXT NOT NULL,
  profile  TEXT NOT NULL,
  at       TEXT NOT NULL,
  at_ms    INTEGER NOT NULL
) STRICT;

-- A run is identified by (project, run, profile) and registering it again is a
-- no-op. A run counted twice halves every rate derived from it, and a caller that
-- approves half its components separately legitimately writes twice.
CREATE UNIQUE INDEX runs_identity ON runs (project, run, profile);
CREATE INDEX runs_window ON runs (project, at_ms);

CREATE TABLE observations (
  project   TEXT NOT NULL,
  subject   TEXT NOT NULL,
  component TEXT NOT NULL,
  band      TEXT NOT NULL,
  hash      TEXT NOT NULL,
  profile   TEXT NOT NULL,
  "commit"  TEXT NOT NULL,
  run       TEXT NOT NULL,
  at        TEXT NOT NULL,
  at_ms     INTEGER NOT NULL,
  accepted  INTEGER NOT NULL,
  file      TEXT
) STRICT;

-- Deliberately no unique constraint on the observed key. Two commits reporting
-- different hashes for one (subject, component, band) is the case the service
-- exists for; a uniqueness rule here would turn it into a write error or, worse,
-- an upsert that discards one branch's observation.
CREATE INDEX observations_area      ON observations (project, subject, component, band, at_ms);
CREATE INDEX observations_component ON observations (project, component, at_ms);
CREATE INDEX observations_reach     ON observations (project, component, subject, at_ms);

CREATE TABLE token_values (
  project  TEXT NOT NULL,
  token    TEXT NOT NULL,
  value    TEXT NOT NULL,
  "commit" TEXT NOT NULL,
  at       TEXT NOT NULL,
  at_ms    INTEGER NOT NULL,
  run      TEXT NOT NULL,
  accepted INTEGER NOT NULL
) STRICT;

CREATE INDEX token_values_journey ON token_values (project, token, at_ms);

CREATE TRIGGER runs_are_append_only BEFORE UPDATE ON runs BEGIN
  SELECT RAISE(ABORT, 'runs are append-only: a recorded run is a fact about a moment, and rewriting one changes a denominator somebody already read');
END;
CREATE TRIGGER runs_are_permanent BEFORE DELETE ON runs BEGIN
  SELECT RAISE(ABORT, 'runs are append-only: deleting a quiet run inflates every rate computed over its window');
END;
CREATE TRIGGER observations_are_append_only BEFORE UPDATE ON observations BEGIN
  SELECT RAISE(ABORT, 'observations are append-only: two hashes for one key are two rows, and an update is the merge this store exists to avoid');
END;
CREATE TRIGGER observations_are_permanent BEFORE DELETE ON observations BEGIN
  SELECT RAISE(ABORT, 'observations are append-only: a deleted change is a change nobody can ever ask about again');
END;
CREATE TRIGGER token_values_are_append_only BEFORE UPDATE ON token_values BEGIN
  SELECT RAISE(ABORT, 'token values are append-only: a rewritten value breaks the journey that was the reason for keeping it');
END;
CREATE TRIGGER token_values_are_permanent BEFORE DELETE ON token_values BEGIN
  SELECT RAISE(ABORT, 'token values are append-only: a removed step turns a drift total into a lower bound with nothing saying so');
END;
`;

export interface SqliteBackendOptions {
  /** File path, or `':memory:'` for a store that ends with the process. */
  readonly path: string;
}

/**
 * Open — or create — the operator's history database.
 *
 * Synchronous by construction. `node:sqlite` has no asynchronous API, and
 * pretending otherwise by wrapping every call in a resolved promise would suggest
 * concurrency the engine does not have. The `HistoryBackend` methods return
 * promises because the *interface* must admit an engine that is genuinely remote;
 * this implementation simply resolves immediately, and the one service process
 * that owns the file serializes writes by being one process (spec 0002, known
 * limits).
 */
export function createSqliteBackend(options: SqliteBackendOptions): HistoryBackend {
  const database = new Database(options.path);

  try {
    prepareSchema(database, options.path);
  } catch (error) {
    // A half-open database is worse than none: the process would keep the file
    // locked while answering nothing.
    database.close();
    throw error;
  }

  // Prepared statements are cached by their SQL text rather than enumerated up
  // front, because the predicates below are assembled per query — an unscoped
  // question and a project-scoped one are different statements, and forcing them
  // into one with `(:project IS NULL OR project = :project)` would cost the
  // leading index column on every query that does scope.
  const statements = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  const prepare = (sql: string): ReturnType<DatabaseSync['prepare']> => {
    const existing = statements.get(sql);
    if (existing !== undefined) return existing;
    const statement = database.prepare(sql);
    statements.set(sql, statement);
    return statement;
  };

  return {
    async append(run, observations, tokens): Promise<void> {
      // One transaction, because rows without their run leave a change with no
      // denominator and a run without its rows is a quiet run that was not quiet.
      // `IMMEDIATE` takes the write lock at the start rather than at the first
      // write, so two concurrent CI jobs queue instead of one discovering it lost
      // halfway through.
      database.exec('BEGIN IMMEDIATE');
      try {
        registerRun(prepare, run);

        const insertObservation = prepare(
          'INSERT INTO observations ' +
            '(project, subject, component, band, hash, profile, "commit", run, at, at_ms, accepted, file) ' +
            'VALUES ($project, $subject, $component, $band, $hash, $profile, $commit, $run, $at, $at_ms, $accepted, $file)',
        );
        for (const row of observations) {
          insertObservation.run({
            $project: row.project,
            $subject: row.subject,
            $component: row.component,
            $band: row.band,
            $hash: row.hash,
            $profile: row.profile,
            $commit: row.commit,
            $run: row.run,
            $at: row.at,
            $at_ms: instant(row.at, 'observation'),
            $accepted: row.accepted ? 1 : 0,
            $file: row.file ?? null,
          });
        }

        const shipped = carriesAnApproval(observations);
        const insertValue = prepare(
          'INSERT INTO token_values (project, token, value, "commit", at, at_ms, run, accepted) ' +
            'VALUES ($project, $token, $value, $commit, $at, $at_ms, $run, $accepted)',
        );
        for (const row of tokens) {
          insertValue.run({
            $project: row.project,
            $token: row.token,
            $value: row.value,
            $commit: row.commit,
            $at: row.at,
            $at_ms: instant(row.at, 'token value'),
            $run: run.run,
            $accepted: shipped ? 1 : 0,
          });
        }

        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    async lastObservation(query): Promise<Observation | null> {
      const filter = areaFilter(query);
      const row = prepare(
        `SELECT * FROM observations WHERE 1 = 1${filter.sql} ORDER BY at_ms DESC, rowid DESC LIMIT 1`,
      ).get(filter.params);

      return row === undefined ? null : toObservation(row);
    },

    async runsIn(query): Promise<Slice<RunRecord>> {
      const filter = windowFilter(query);
      return slice(prepare, 'runs', filter, query.limit, toRunRecord);
    },

    async observationsOf(query): Promise<Slice<Observation>> {
      const filter = componentFilter(query);
      return slice(prepare, 'observations', filter, query.limit, toObservation);
    },

    async valuesOf(query): Promise<Slice<TokenValue>> {
      const filter = tokenFilter(query);
      return slice(prepare, 'token_values', filter, query.limit, toTokenValue);
    },

    async reachOf(query): Promise<ReachRows> {
      return reachRows(prepare, query);
    },

    async close(): Promise<void> {
      statements.clear();
      database.close();
    },
  };
}

/**
 * Whether the values a write carried describe something that shipped.
 *
 * `TokenValue` has no acceptance of its own — it records what a commit resolved
 * to, and acceptance is a fact about the run that proposed it — so the join has
 * to be made here, at write time, from the observations that arrived with it.
 *
 * The rule is deliberately asymmetric. A write with no rows at all is a quiet
 * run: nothing was proposed, so nothing was rejected, and the values it resolved
 * are the ones in force. A write is treated as unshipped only when it carried
 * rows and *none* of them were approved. A mixed write — the case the history
 * package's `RunContext` documents, where half a run's components were decided
 * separately — counts as shipped.
 *
 * That asymmetry is a choice between two wrong answers, made in the direction the
 * product cares about. Including a value that was not shipped puts a step in a
 * journey that an investigator can follow to a commit and dismiss. Excluding a
 * value that *was* shipped removes a step from a sum, and the sum is the entire
 * point: eleven approved 2px steps that nobody ever saw as 22px. A missing step
 * is a smaller number that nothing on the page contradicts, and nobody knows to
 * look for it. The cost is stated rather than fixed because fixing it needs a
 * per-value acceptance the recorded shape does not carry (spec 0002).
 */
function carriesAnApproval(observations: readonly Observation[]): boolean {
  return observations.length === 0 || observations.some((row) => row.accepted);
}

/**
 * Register the run, or confirm the one already registered is the same run.
 *
 * `INSERT OR IGNORE` would have been one line and would have silently accepted a
 * second write claiming a different commit for the same run id. Lineage is the
 * one thing a store of observations offers instead of a merge, and a run id that
 * points at two commits makes every question asked by lineage unanswerable —
 * quietly, and only for the branches that happen to overlap.
 */
function registerRun(prepare: Prepare, run: RunRecord): void {
  const existing = prepare(
    'SELECT "commit", at FROM runs WHERE project = $project AND run = $run AND profile = $profile',
  ).get({ $project: run.project, $run: run.run, $profile: run.profile });

  if (existing !== undefined) {
    const recorded = text(existing, 'commit', 'run');
    if (recorded !== run.commit) {
      throw new HistoryWriteConflict(
        `run "${run.run}" of project "${run.project}" under ${run.profile} is already recorded ` +
          `at commit ${recorded}; this write claims ${run.commit}. A run id that points at two ` +
          'commits makes every question asked by lineage unanswerable, so the write is refused ' +
          'rather than appended alongside it',
      );
    }
    return;
  }

  prepare(
    'INSERT INTO runs (project, run, "commit", profile, at, at_ms) ' +
      'VALUES ($project, $run, $commit, $profile, $at, $at_ms)',
  ).run({
    $project: run.project,
    $run: run.run,
    $commit: run.commit,
    $profile: run.profile,
    $at: run.at,
    $at_ms: instant(run.at, 'run'),
  });
}

/**
 * Create the schema, or refuse a database this build cannot read correctly.
 *
 * Three outcomes, and the middle one is the reason this function is not a
 * `CREATE TABLE IF NOT EXISTS`:
 *
 * - an empty file becomes a store at the current version;
 * - a store written by a **newer** version is refused, because the alternative is
 *   reading its rows through this version's assumptions and answering drift
 *   questions from a shape that no longer means what it did;
 * - a file that already holds tables but carries no version of ours is refused
 *   too. `IF NOT EXISTS` would have adopted somebody else's database and started
 *   appending to it.
 *
 * An older version is refused rather than migrated because no migration exists
 * yet. Writing one is a change to this file; guessing is a change to everyone's
 * numbers.
 */
function prepareSchema(database: DatabaseSync, path: string): void {
  database.exec('PRAGMA journal_mode = WAL');
  // One process owns the file, but a crashed predecessor can still hold a lock
  // for a moment. Failing instantly on that is a service that will not restart.
  database.exec('PRAGMA busy_timeout = 5000');

  const version = number(
    database.prepare('PRAGMA user_version').get() ?? {},
    'user_version',
    'the schema version',
  );

  if (version > SCHEMA_VERSION) {
    throw new Error(
      `the history database at ${path} was written by schema version ${version}; this build ` +
        `understands ${SCHEMA_VERSION}. Refusing to open it: reading a newer shape through older ` +
        'assumptions answers drift questions with numbers that are wrong in a way nothing shows',
    );
  }

  if (version === SCHEMA_VERSION) return;

  if (version !== 0) {
    throw new Error(
      `the history database at ${path} was written by schema version ${version}; this build ` +
        `understands ${SCHEMA_VERSION} and carries no migration from ${version}. Refusing to ` +
        'open it rather than guessing what its rows mean',
    );
  }

  const populated = database.prepare('SELECT COUNT(*) AS tables FROM sqlite_master').get() ?? {};
  if (number(populated, 'tables', 'the table count') > 0) {
    throw new Error(
      `the file at ${path} is an SQLite database with no history schema version in it, so it was ` +
        'written by something else. Refusing to add tables to a database this service does not ' +
        'own; point it at a new path',
    );
  }

  database.exec(SCHEMA);
  // Not parameterizable — `PRAGMA` takes no bindings. The value is a module
  // constant, never anything that reached the process from outside.
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

type Prepare = (sql: string) => {
  get(params: Record<string, SQLInputValue>): Record<string, SQLOutputValue> | undefined;
  all(params: Record<string, SQLInputValue>): Record<string, SQLOutputValue>[];
  run(params: Record<string, SQLInputValue>): unknown;
};

interface Filter {
  readonly sql: string;
  readonly params: Record<string, SQLInputValue>;
}

/**
 * A window as SQL, over the parsed instant rather than the stored text.
 *
 * `since` and `until` are parsed here and not only at the HTTP edge, because the
 * backend is a public interface of this package and an in-process caller reaches
 * it without passing an edge. A window bound that does not parse would otherwise
 * become `NaN`, which SQLite binds as NULL, which compares false against every
 * row — an empty answer that reads as "nothing changed".
 */
function windowFilter(query: WindowQuery): Filter {
  const clauses: string[] = [];
  const params: Record<string, SQLInputValue> = {};

  scopeInto(query, clauses, params);

  if (query.since !== undefined) {
    clauses.push('at_ms >= $since');
    params['$since'] = instant(query.since, 'window `since`');
  }
  if (query.until !== undefined) {
    clauses.push('at_ms <= $until');
    params['$until'] = instant(query.until, 'window `until`');
  }

  return { sql: clauses.map((clause) => ` AND ${clause}`).join(''), params };
}

function componentFilter(query: ComponentWindowQuery): Filter {
  const base = windowFilter(query);
  return {
    sql: `${base.sql} AND component = $component`,
    params: { ...base.params, $component: query.component },
  };
}

function tokenFilter(query: TokenWindowQuery): Filter {
  const base = windowFilter(query);
  return {
    // Only values a write carrying an approval left behind; see
    // `carriesAnApproval`.
    sql: `${base.sql} AND token = $token AND accepted = 1`,
    params: { ...base.params, $token: query.token },
  };
}

function areaFilter(query: AreaQuery): Filter {
  const clauses: string[] = ['subject = $subject', 'component = $component'];
  const params: Record<string, SQLInputValue> = {
    $subject: query.subject,
    $component: query.component,
  };

  scopeInto(query, clauses, params);

  if (query.band !== undefined) {
    clauses.push('band = $band');
    params['$band'] = query.band;
  }

  return { sql: clauses.map((clause) => ` AND ${clause}`).join(''), params };
}

function scopeInto(
  query: BackendQuery,
  clauses: string[],
  params: Record<string, SQLInputValue>,
): void {
  if (query.project === undefined) return;
  clauses.push('project = $project');
  params['$project'] = query.project;
}

/**
 * The newest rows that fit, returned oldest first, plus the count of the rest.
 *
 * Newest-first selection and chronological return are both deliberate. A limited
 * drift question is asking what has happened lately, so dropping the *old* end
 * keeps the answer's subject; and every consumer — a journey, a churn window —
 * reads better in the order the events happened. What the limit excluded is
 * counted with a second query rather than inferred from a `limit + 1` probe,
 * because "there are more" is not a number and a lower bound whose distance from
 * the truth is unknown is not worth printing.
 */
function slice<Row>(
  prepare: Prepare,
  table: string,
  filter: Filter,
  limit: number | undefined,
  read: (row: Record<string, SQLOutputValue>) => Row,
): Slice<Row> {
  const where = `WHERE 1 = 1${filter.sql}`;

  if (limit === undefined) {
    const rows = prepare(`SELECT * FROM ${table} ${where} ORDER BY at_ms ASC, rowid ASC`).all(
      filter.params,
    );
    return { rows: rows.map(read), omitted: 0 };
  }

  const total = number(
    prepare(`SELECT COUNT(*) AS total FROM ${table} ${where}`).get(filter.params) ?? {},
    'total',
    `a count of ${table}`,
  );

  const newest = prepare(
    `SELECT * FROM ${table} ${where} ORDER BY at_ms DESC, rowid DESC LIMIT $limit`,
  ).all({ ...filter.params, $limit: limit });

  return { rows: newest.reverse().map(read), omitted: Math.max(0, total - newest.length) };
}

/**
 * Reach, in one grouped query plus a correlated lookup outside the window.
 *
 * The correlated subquery is the whole point: `arrived` asks whether a subject's
 * *first-ever* observation of this component falls inside the window, which the
 * window's own rows cannot answer. Without it every subject looks new in every
 * window, and "seven subjects started using Button this quarter" — the one answer
 * a single run genuinely cannot produce — degrades into a restatement of the
 * subject list.
 *
 * Grouping is by `(project, subject)` even though the answer is a list of subject
 * names, so that an unscoped query over two projects does not fuse two different
 * subjects that happen to share a name. The names are then de-duplicated in
 * first-seen order, which is the one place an unscoped query is visibly lossy.
 */
function reachRows(prepare: Prepare, query: ComponentWindowQuery): ReachRows {
  const filter = componentFilter(query);
  const where = `WHERE 1 = 1${filter.sql}`;

  // The outer table is left unaliased so the same `Filter` builder serves this
  // query and the flat ones; the correlated subquery aliases *its* copy instead
  // and refers back by table name.
  const grouped =
    'SELECT subject, MIN(at_ms) AS first_in_window, ' +
    '(SELECT MIN(e.at_ms) FROM observations e WHERE e.project = observations.project ' +
    'AND e.component = observations.component AND e.subject = observations.subject) AS first_ever ' +
    `FROM observations ${where} ` +
    'GROUP BY project, subject ORDER BY first_in_window ASC, subject ASC';

  const limited = query.limit === undefined ? grouped : `${grouped} LIMIT $limit`;
  const params =
    query.limit === undefined ? filter.params : { ...filter.params, $limit: query.limit };

  const rows = prepare(limited).all(params);

  const total =
    query.limit === undefined
      ? rows.length
      : number(
          prepare(`SELECT COUNT(*) AS total FROM (${grouped})`).get(filter.params) ?? {},
          'total',
          'a count of subjects',
        );

  const since = query.since === undefined ? undefined : instant(query.since, 'window `since`');

  const subjects: string[] = [];
  const arrived: string[] = [];
  for (const row of rows) {
    const subject = text(row, 'subject', 'a reach row');
    if (!subjects.includes(subject)) subjects.push(subject);

    const firstEver = number(row, 'first_ever', 'a reach row');
    if ((since === undefined || firstEver >= since) && !arrived.includes(subject)) {
      arrived.push(subject);
    }
  }

  return { subjects, arrived, omittedSubjects: Math.max(0, total - rows.length) };
}

/**
 * An instant as a comparable number.
 *
 * Refuses rather than defaults. A row whose `at` cannot be parsed would land with
 * a NULL ordering key, sort ahead of or behind everything depending on the query,
 * and turn `12px → 20px` into `20px → 12px` — a confident sentence that is exactly
 * backwards.
 */
function instant(at: string, what: string): number {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) {
    throw new Error(`${what} carries "${at}", which is not an ISO-8601 instant`);
  }
  return parsed;
}

/**
 * Reading a row back is validation, not a cast.
 *
 * SQLite is typed per value, not per column, and `STRICT` tables only constrain
 * what this build writes. A row written by a future version, or by a person with
 * a SQL prompt, reaches here as whatever it is; casting it would let a number
 * become a component name and a NULL become the string "null" three layers later.
 */
function text(row: Record<string, SQLOutputValue>, column: string, what: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new Error(`${what} has a \`${column}\` that is not text: ${describe(value)}`);
  }
  return value;
}

function optionalText(
  row: Record<string, SQLOutputValue>,
  column: string,
  what: string,
): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${what} has a \`${column}\` that is neither text nor null: ${describe(value)}`);
  }
  return value;
}

function number(row: Record<string, SQLOutputValue>, column: string, what: string): number {
  const value = row[column];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what} has a \`${column}\` that is not a number: ${describe(value)}`);
  }
  return value;
}

function band(row: Record<string, SQLOutputValue>, what: string): Band {
  const value = text(row, 'band', what);
  if (!BANDS.includes(value as Band)) {
    throw new Error(`${what} has an unknown band "${value}"`);
  }
  return value as Band;
}

/**
 * Profiles are checked against `core`'s table rather than a list kept here, so a
 * new tier does not become a store that rejects rows the rest of the system
 * considers valid.
 */
function profile(row: Record<string, SQLOutputValue>, what: string): ProfileId {
  const value = text(row, 'profile', what);
  const known: unknown = profileById(value as ProfileId);
  if (known === undefined) throw new Error(`${what} has an unknown profile "${value}"`);
  return value as ProfileId;
}

function toObservation(row: Record<string, SQLOutputValue>): Observation {
  const what = 'a stored observation';
  const file = optionalText(row, 'file', what);

  return {
    project: text(row, 'project', what),
    subject: text(row, 'subject', what),
    component: text(row, 'component', what),
    band: band(row, what),
    hash: text(row, 'hash', what) as Digest,
    profile: profile(row, what),
    commit: text(row, 'commit', what),
    run: text(row, 'run', what),
    at: text(row, 'at', what),
    accepted: number(row, 'accepted', what) !== 0,
    ...(file !== undefined ? { file } : {}),
  };
}

function toRunRecord(row: Record<string, SQLOutputValue>): RunRecord {
  const what = 'a stored run';
  return {
    project: text(row, 'project', what),
    run: text(row, 'run', what),
    commit: text(row, 'commit', what),
    profile: profile(row, what),
    at: text(row, 'at', what),
  };
}

function toTokenValue(row: Record<string, SQLOutputValue>): TokenValue {
  const what = 'a stored token value';
  return {
    project: text(row, 'project', what),
    token: text(row, 'token', what),
    value: text(row, 'value', what),
    commit: text(row, 'commit', what),
    at: text(row, 'at', what),
  };
}

function describe(value: SQLOutputValue | undefined): string {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  return `${typeof value} (${String(value).slice(0, 60)})`;
}
