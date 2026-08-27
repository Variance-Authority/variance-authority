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
} from '@variance-authority/server';
import { requireD1, type D1Like, type D1PreparedLike } from './bindings.js';
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
} from './history-queries.js';
import {
  instant,
  text,
  toApproval,
  toInstability,
  toObservation,
  toRunRecord,
  toTokenValue,
  type Row,
} from './history-rows.js';

/**
 * The history record, on D1.
 *
 * A second implementation of `HistoryBackend`, and deliberately a *transcription*
 * of [`server/backend-sqlite.ts`](../../server/src/backend-sqlite.ts) rather than
 * a fresh design. The seam exists so that replacing the engine changes one file
 * and not what a row means; the way to honour that is for the two files to be
 * boringly alike — same filters, same limit arithmetic, same correlated subquery
 * for `arrived`, same refusal to cast a row it read back.
 *
 * **No arithmetic happens here.** Churn, journeys and reach are computed by
 * `churnFrom`/`journeyFrom`/`reachFrom` in `@variance-authority/server`, over the
 * rows this returns. That is what stops two backends disagreeing about what a
 * number means, and it is why this file has no idea what a rate is.
 *
 * ## The two places D1 is not SQLite-in-a-process
 *
 * **No `BEGIN IMMEDIATE`.** Atomicity comes from `batch`, which D1 documents as
 * one implicit transaction that rolls back entirely on failure. Every write here
 * is one batch, so a run and its rows still land together or not at all.
 *
 * **No serialization around a read-then-write.** The SQLite backend takes the
 * write lock before checking whether a run id is already registered; two Workers
 * cannot. So the check is not what enforces lineage — the `WHERE NOT EXISTS`
 * guard on the insert is, and the unique index behind it. The read survives only
 * to produce a sentence naming both commits, because a caller who gets
 * `UNIQUE constraint failed` has to come and read this file to find out what
 * happened.
 *
 * ## What is next door
 *
 * Reading a stored value back is [`history-rows.ts`](./history-rows.ts), and it
 * is a separate file for the same reason no arithmetic happens here: what a row
 * is allowed to be is not a property of any one query, and this file knows
 * nothing about it.
 */

export function createD1Backend(db: D1Like): HistoryBackend {
  requireD1(db);

  return {
    async append(run, observations, tokens, instabilities = []): Promise<void> {
      const registered = await registeredCommit(db, run);
      if (registered !== null && registered !== run.commit) throw conflict(run, registered);

      const shipped = carriesAnApproval(observations);
      const statements: D1PreparedLike[] = [
        // One statement, and it is the lineage rule rather than a convenience.
        // If a row already exists for this `(project, run, profile)` with *this*
        // commit, the `NOT EXISTS` is false and nothing is inserted — re-appending
        // a run is legitimate, because a caller whose components were approved
        // separately writes twice, and a run counted twice halves every rate
        // derived from it forever.
        //
        // If a row exists with a *different* commit, the `NOT EXISTS` is true, the
        // insert proceeds, and `runs_identity` refuses it — which aborts the whole
        // batch. That is the only part of this that holds under two concurrent
        // Workers, and it is why the check above is a message rather than a guard.
        db
          .prepare(
            `INSERT INTO runs (project, run, "commit", profile, at, at_ms, swept)
             SELECT ?, ?, ?, ?, ?, ?, ?
              WHERE NOT EXISTS (
                    SELECT 1 FROM runs
                     WHERE project = ? AND run = ? AND profile = ? AND "commit" = ?)`,
          )
          .bind(
            run.project,
            run.run,
            run.commit,
            run.profile,
            run.at,
            instant(run.at, 'run'),
            // NULL when the caller did not say. Transcribed with its reason: a
            // run stored as having examined nothing puts a denominator under a
            // flake rate that nobody measured.
            run.swept === undefined ? null : run.swept ? 1 : 0,
            run.project,
            run.run,
            run.profile,
            run.commit,
          ),
      ];

      for (const row of observations) {
        statements.push(
          db
            .prepare(
              `INSERT INTO observations
                 (project, subject, component, band, hash, profile, "commit", run, at, at_ms,
                  accepted, file)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              row.project,
              row.subject,
              row.component,
              row.band,
              row.hash,
              row.profile,
              row.commit,
              row.run,
              row.at,
              instant(row.at, 'observation'),
              row.accepted ? 1 : 0,
              row.file ?? null,
            ),
        );
      }

      for (const row of tokens) {
        statements.push(
          db
            .prepare(
              `INSERT INTO token_values (project, token, value, "commit", at, at_ms, run, accepted)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              row.project,
              row.token,
              row.value,
              row.commit,
              row.at,
              instant(row.at, 'token value'),
              run.run,
              shipped ? 1 : 0,
            ),
        );
      }

      for (const row of instabilities) {
        statements.push(
          db
            .prepare(
              `INSERT INTO instabilities
                 (project, subject, component, band, profile, "commit", run, at, at_ms, absorbed_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              row.project,
              row.subject,
              // Null, not the empty string: readings that could not be resolved
              // to a component named nobody, which is not the same as the
              // disagreement belonging to no component.
              row.component ?? null,
              row.band ?? null,
              row.profile,
              row.commit,
              row.run,
              row.at,
              instant(row.at, 'instability'),
              row.absorbedBy ?? null,
            ),
        );
      }

      try {
        await db.batch(statements);
      } catch (error) {
        // The guard above fired between the check and the write. Re-read so the
        // operator gets the two commits rather than an index name.
        const current = await registeredCommit(db, run).catch(() => null);
        if (current !== null && current !== run.commit) throw conflict(run, current);
        throw error;
      }
    },

    async appendApprovals(approvals): Promise<void> {
      if (approvals.length === 0) return;

      // `OR IGNORE` against `approvals_identity`, transcribed: approving twice is
      // approving once, and a refusal would turn a second click into a failure.
      await db.batch(
        approvals.map((approval) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO approvals (project, subject, run, at, at_ms, approver)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              approval.project,
              approval.subject,
              approval.run,
              approval.at,
              instant(approval.at, 'approval'),
              approval.by ?? null,
            ),
        ),
      );
    },

    async approvalsOf(query): Promise<Slice<Approval>> {
      return slice(db, 'approvals', windowFilter(query), query.limit, toApproval);
    },

    async currentOf(query): Promise<readonly Observation[]> {
      return currentRows(db, query);
    },

    async currentTokens(query): Promise<readonly TokenValue[]> {
      return currentTokenRows(db, query);
    },

    async lastObservation(query): Promise<Observation | null> {
      const filter = areaFilter(query);
      const row = await db
        .prepare(
          `SELECT * FROM observations WHERE 1 = 1${filter.sql} ORDER BY at_ms DESC, rowid DESC LIMIT 1`,
        )
        .bind(...filter.params)
        .first<Row>();

      return row === null ? null : toObservation(row);
    },

    async runsIn(query): Promise<Slice<RunRecord>> {
      return slice(db, 'runs', windowFilter(query), query.limit, toRunRecord);
    },

    async observationsOf(query): Promise<Slice<Observation>> {
      return slice(db, 'observations', componentFilter(query), query.limit, toObservation);
    },

    async instabilitiesOf(query): Promise<Slice<Instability>> {
      return slice(db, 'instabilities', subjectFilter(query), query.limit, toInstability);
    },

    async valuesOf(query): Promise<Slice<TokenValue>> {
      return slice(db, 'token_values', tokenFilter(query), query.limit, toTokenValue);
    },

    async reachOf(query): Promise<ReachRows> {
      return reachRows(db, query);
    },

    /**
     * Nothing to close.
     *
     * A binding is not a handle this code opened, and a Worker that closed one
     * would break every other request sharing the isolate. Present because the
     * interface has it, and empty for the same reason a stateless service has no
     * shutdown.
     */
    async close(): Promise<void> {},
  };
}

async function registeredCommit(db: D1Like, run: RunRecord): Promise<string | null> {
  const row = await db
    .prepare('SELECT "commit" FROM runs WHERE project = ? AND run = ? AND profile = ?')
    .bind(run.project, run.run, run.profile)
    .first<Row>();

  return row === null ? null : text(row, 'commit', 'a stored run');
}

function conflict(run: RunRecord, recorded: string): HistoryWriteConflict {
  return new HistoryWriteConflict(
    `run "${run.run}" of project "${run.project}" under ${run.profile} is already recorded ` +
      `at commit ${recorded}; this write claims ${run.commit}. A run id that points at two ` +
      'commits makes every question asked by lineage unanswerable, so the write is refused ' +
      'rather than appended alongside it',
  );
}

/**
 * Whether the write itself already carried an approval.
 *
 * Transcribed from the SQLite backend, and provenance about the write in both.
 * Which values a journey is made of is decided by `journeyFrom`, which both
 * backends share and which asks the approvals table.
 */
function carriesAnApproval(observations: readonly Observation[]): boolean {
  return observations.length === 0 || observations.some((row) => row.accepted);
}
