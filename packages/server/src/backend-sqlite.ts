import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Approval,
  Instability,
  Observation,
  RunRecord,
  TokenValue,
} from '@variance-authority/history';
import {
  HistoryWriteConflict,
  type HistoryBackend,
  type ReachRows,
  type Slice,
} from './backend.js';
import {
  areaFilter,
  componentFilter,
  currentRows,
  currentTokenRows,
  reachRows,
  slice,
  subjectFilter,
  tokenFilter,
  windowFilter,
  type Prepare,
} from './sqlite-queries.js';
import {
  instant,
  text,
  toApproval,
  toInstability,
  toObservation,
  toRunRecord,
  toTokenValue,
} from './sqlite-rows.js';
import { prepareSchema } from './sqlite-schema.js';

/**
 * SQLite, reached through exactly one door.
 *
 * `node:sqlite` is marked experimental on Node 22 and prints a warning on import.
 * That is not a reason to avoid it — it is the reason this module exists as the
 * only place that names it. A self-hosted service that requires a native build to
 * install is a service nobody installs, and "a single file and a port" is the
 * whole operational burden this deployment shape is trying to keep (spec 0002).
 * When the module's API moves, or when one file stops being enough, the blast
 * radius is this file and the `HistoryBackend` interface holds the rest still.
 *
 * One file did stop being enough. What is left here is the connection and the
 * writes: opening the database, caching statements, and appending a run with its
 * rows. The stored shape and its version live in `sqlite-schema.ts`, the
 * predicates and the shaped reads in `sqlite-queries.ts`, and the row→value
 * checking in `sqlite-rows.ts`. Only this file names `node:sqlite` at runtime; the
 * others take a handle or a row and know nothing about where it came from.
 */

export { SCHEMA_VERSION } from './sqlite-schema.js';

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
  // front, because the predicates are assembled per query — an unscoped
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
    async append(run, observations, tokens, instabilities = []): Promise<void> {
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

        const insertInstability = prepare(
          'INSERT INTO instabilities ' +
            '(project, subject, component, band, profile, "commit", run, at, at_ms, absorbed_by) ' +
            'VALUES ($project, $subject, $component, $band, $profile, $commit, $run, $at, $at_ms, $absorbed_by)',
        );
        for (const row of instabilities) {
          insertInstability.run({
            $project: row.project,
            $subject: row.subject,
            // Null, not the empty string. A collector that supplied no snapshot
            // proved the instability and gave nobody the means to name it, which
            // is not the same as the disagreement belonging to no component.
            $component: row.component ?? null,
            $band: row.band ?? null,
            $profile: row.profile,
            $commit: row.commit,
            $run: row.run,
            $at: row.at,
            $at_ms: instant(row.at, 'instability'),
            $absorbed_by: row.absorbedBy ?? null,
          });
        }

        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    async appendApprovals(approvals): Promise<void> {
      // `OR IGNORE` against `approvals_identity`, because approving twice is
      // approving once: a reviewer who clicks accept a second time has not made a
      // second decision, and a refusal would turn that into a failed command.
      const insert = prepare(
        'INSERT OR IGNORE INTO approvals (project, subject, run, at, at_ms, approver) ' +
          'VALUES ($project, $subject, $run, $at, $at_ms, $approver)',
      );

      database.exec('BEGIN IMMEDIATE');
      try {
        for (const approval of approvals) {
          insert.run({
            $project: approval.project,
            $subject: approval.subject,
            $run: approval.run,
            $at: approval.at,
            $at_ms: instant(approval.at, 'approval'),
            $approver: approval.by ?? null,
          });
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    async approvalsOf(query): Promise<Slice<Approval>> {
      return slice(prepare, 'approvals', windowFilter(query), query.limit, toApproval);
    },

    async currentOf(query): Promise<readonly Observation[]> {
      return currentRows(prepare, query).map(toObservation);
    },

    async currentTokens(query): Promise<readonly TokenValue[]> {
      return currentTokenRows(prepare, query).map(toTokenValue);
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

    async instabilitiesOf(query): Promise<Slice<Instability>> {
      return slice(prepare, 'instabilities', subjectFilter(query), query.limit, toInstability);
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
    'INSERT INTO runs (project, run, "commit", profile, at, at_ms, swept) ' +
      'VALUES ($project, $run, $commit, $profile, $at, $at_ms, $swept)',
  ).run({
    $project: run.project,
    $run: run.run,
    $commit: run.commit,
    $profile: run.profile,
    $at: run.at,
    $at_ms: instant(run.at, 'run'),
    // NULL when the caller did not say, which is not `0`. A run that never
    // reported what it examined must not become evidence that it examined
    // nothing — that would put a denominator under a flake rate that nobody
    // measured.
    $swept: run.swept === undefined ? null : run.swept ? 1 : 0,
  });
}
