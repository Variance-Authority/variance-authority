import type { Observation, RunRecord, TokenValue } from '@variance-authority/history';
import {
  HistoryWriteConflict,
  type AreaQuery,
  type BackendQuery,
  type ComponentWindowQuery,
  type HistoryBackend,
  type ReachRows,
  type Slice,
  type SubjectsQuery,
  type TokenWindowQuery,
  type WindowQuery,
} from '@variance-authority/server';
import type { D1Like, D1PreparedLike, D1Value } from './bindings.js';
import {
  instant,
  number,
  text,
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
  return {
    async append(run, observations, tokens): Promise<void> {
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
            `INSERT INTO runs (project, run, "commit", profile, at, at_ms)
             SELECT ?, ?, ?, ?, ?, ?
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

    async currentOf(query): Promise<readonly Observation[]> {
      return currentRows(db, query);
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
 * Whether the values a write carried describe something that shipped.
 *
 * Transcribed from the SQLite backend, asymmetry included: a write with no rows
 * is a quiet run whose values are the ones in force, and a write is treated as
 * unshipped only when it carried rows and none of them were approved. Two
 * backends that judged this differently would give one database's journey a step
 * the other's does not have, for the same commits.
 */
function carriesAnApproval(observations: readonly Observation[]): boolean {
  return observations.length === 0 || observations.some((row) => row.accepted);
}

interface Filter {
  readonly sql: string;
  readonly params: readonly D1Value[];
}

/**
 * A window as SQL, over the parsed instant rather than the stored text.
 *
 * ISO-8601 sorts lexically only while every timestamp shares one offset, and a
 * store fed by CI jobs in two regions does not. A bound that will not parse is
 * refused here rather than bound as `NaN`, which would reach SQLite as NULL,
 * compare false against every row, and return an empty answer that reads as
 * "nothing changed".
 */
function windowFilter(query: WindowQuery): Filter {
  const clauses: string[] = [];
  const params: D1Value[] = [];

  scopeInto(query, clauses, params);

  if (query.since !== undefined) {
    clauses.push('at_ms >= ?');
    params.push(instant(query.since, 'window `since`'));
  }
  if (query.until !== undefined) {
    clauses.push('at_ms <= ?');
    params.push(instant(query.until, 'window `until`'));
  }

  return { sql: clauses.map((clause) => ` AND ${clause}`).join(''), params };
}

function componentFilter(query: ComponentWindowQuery): Filter {
  const base = windowFilter(query);
  return {
    sql: `${base.sql} AND component = ?`,
    params: [...base.params, query.component],
  };
}

function tokenFilter(query: TokenWindowQuery): Filter {
  const base = windowFilter(query);
  // Only values a write carrying an approval left behind. A journey through
  // values that were never shipped describes the review process rather than the
  // product, and every number in it looks real.
  return {
    sql: `${base.sql} AND token = ? AND accepted = 1`,
    params: [...base.params, query.token],
  };
}

function areaFilter(query: AreaQuery): Filter {
  const clauses = ['subject = ?', 'component = ?'];
  const params: D1Value[] = [query.subject, query.component];

  scopeInto(query, clauses, params);

  if (query.band !== undefined) {
    clauses.push('band = ?');
    params.push(query.band);
  }

  return { sql: clauses.map((clause) => ` AND ${clause}`).join(''), params };
}

/**
 * One row per live scope in the named subjects: the newest, and only the newest.
 *
 * Transcribed from `sqlite-queries.ts`, window function included. D1 is SQLite,
 * so `ROW_NUMBER()` is available and the tie-break on `rowid` means the same
 * thing — the later write wins when two rows share an instant, which happens
 * whenever one run recorded two profiles from a single clock read.
 *
 * **No `LIMIT`, in either backend.** A trimmed answer here is not a lower bound
 * that a reader can be warned about; it is a `previous` set with a hole in it, and
 * the run then appends a change that did not happen. The request is what is
 * bounded — `MAX_CURRENT_SUBJECTS` — and the HTTP edge refuses a longer one.
 */
async function currentRows(db: D1Like, query: SubjectsQuery): Promise<readonly Observation[]> {
  const subjects = [...new Set(query.subjects)];
  if (subjects.length === 0) return [];

  const clauses: string[] = [];
  const params: D1Value[] = [];
  scopeInto(query, clauses, params);

  clauses.push(`subject IN (${subjects.map(() => '?').join(', ')})`);
  params.push(...subjects);

  const where = clauses.map((clause) => ` AND ${clause}`).join('');

  const rows = await db
    .prepare(
      'SELECT * FROM (SELECT *, ROW_NUMBER() OVER (' +
        'PARTITION BY project, subject, component, band, profile ' +
        'ORDER BY at_ms DESC, rowid DESC) AS recency ' +
        `FROM observations WHERE 1 = 1${where}) WHERE recency = 1`,
    )
    .bind(...params)
    .all<Row>();

  return rows.results.map(toObservation);
}

/**
 * Scope to a project, or deliberately do not.
 *
 * An unscoped query on a shared deployment blends two projects' `Button` into one
 * rate and nothing in the answer would show it. The choice belongs to the caller,
 * so both are implemented and neither is a default.
 */
function scopeInto(query: BackendQuery, clauses: string[], params: D1Value[]): void {
  if (query.project === undefined) return;
  clauses.push('project = ?');
  params.push(query.project);
}

/**
 * The newest rows that fit, returned oldest first, plus the count of the rest.
 *
 * Newest-first selection and chronological return, both deliberate and both
 * transcribed: a limited drift question asks what happened lately, so the *old*
 * end is what gets dropped; and every consumer reads better in the order events
 * happened. What the limit excluded is counted with a second query rather than
 * inferred from a `limit + 1` probe — "there are more" is not a number, and a
 * lower bound whose distance from the truth is unknown is not worth printing.
 */
async function slice<T>(
  db: D1Like,
  table: string,
  filter: Filter,
  limit: number | undefined,
  read: (row: Row) => T,
): Promise<Slice<T>> {
  const where = `WHERE 1 = 1${filter.sql}`;

  if (limit === undefined) {
    const all = await db
      .prepare(`SELECT * FROM ${table} ${where} ORDER BY at_ms ASC, rowid ASC`)
      .bind(...filter.params)
      .all<Row>();
    return { rows: all.results.map(read), omitted: 0 };
  }

  const counted = await db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} ${where}`)
    .bind(...filter.params)
    .first<Row>();
  const total = number(counted ?? {}, 'total', `a count of ${table}`);

  const newest = await db
    .prepare(`SELECT * FROM ${table} ${where} ORDER BY at_ms DESC, rowid DESC LIMIT ?`)
    .bind(...filter.params, limit)
    .all<Row>();

  const rows = [...newest.results].reverse().map(read);
  return { rows, omitted: Math.max(0, total - newest.results.length) };
}

/**
 * Reach, in one grouped query plus a correlated lookup outside the window.
 *
 * The correlated subquery is the point: `arrived` asks whether a subject's
 * *first-ever* observation of this component falls inside the window, which the
 * window's own rows cannot answer. Without it, every subject looks new in every
 * window and the one answer a single run genuinely cannot produce degrades into a
 * restatement of the subject list.
 */
async function reachRows(db: D1Like, query: ComponentWindowQuery): Promise<ReachRows> {
  const filter = componentFilter(query);
  const where = `WHERE 1 = 1${filter.sql}`;

  // Grouped by `(project, subject)` rather than by subject alone, so an unscoped
  // query over two projects does not fuse two different subjects that happen to
  // share a name. The names are de-duplicated below, which is the one place an
  // unscoped question is visibly lossy.
  const grouped =
    'SELECT subject, MIN(at_ms) AS first_in_window, ' +
    '(SELECT MIN(e.at_ms) FROM observations e WHERE e.project = observations.project ' +
    'AND e.component = observations.component AND e.subject = observations.subject) AS first_ever ' +
    `FROM observations ${where} ` +
    'GROUP BY project, subject ORDER BY first_in_window ASC, subject ASC';

  const listed = await (query.limit === undefined
    ? db.prepare(grouped).bind(...filter.params)
    : db.prepare(`${grouped} LIMIT ?`).bind(...filter.params, query.limit)
  ).all<Row>();

  const total =
    query.limit === undefined
      ? listed.results.length
      : number(
          (await db
            .prepare(`SELECT COUNT(*) AS total FROM (${grouped})`)
            .bind(...filter.params)
            .first<Row>()) ?? {},
          'total',
          'a count of subjects',
        );

  const since = query.since === undefined ? undefined : instant(query.since, 'window `since`');

  const subjects: string[] = [];
  const arrived: string[] = [];
  for (const row of listed.results) {
    const subject = text(row, 'subject', 'a reach row');
    if (!subjects.includes(subject)) subjects.push(subject);

    const firstEver = number(row, 'first_ever', 'a reach row');
    if ((since === undefined || firstEver >= since) && !arrived.includes(subject)) {
      arrived.push(subject);
    }
  }

  return { subjects, arrived, omittedSubjects: Math.max(0, total - listed.results.length) };
}
