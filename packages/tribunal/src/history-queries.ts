import type { Observation, TokenValue } from '@variance-authority/history';
import type {
  AreaQuery,
  BackendQuery,
  ComponentWindowQuery,
  ReachRows,
  Slice,
  SubjectsQuery,
  SubjectWindowQuery,
  TokenWindowQuery,
  WindowQuery,
} from '@variance-authority/server';
import type { D1Like, D1Value } from './bindings.js';
import {
  instant,
  number,
  text,
  toObservation,
  toTokenValue,
  type Row,
} from './history-rows.js';

/**
 * The predicates, and the three reads whose shape is not a plain `SELECT *`.
 *
 * Split from [`history.ts`](./history.ts) for the reason the SQLite backend is
 * split the same way: none of this touches a connection's lifetime or a write.
 * Every function takes a binding and returns rows, so what is under test when
 * these are tested is the SQL — and the file next door stays what it says it is,
 * a transcription of the append path.
 *
 * Transcribed, filter for filter, from
 * [`server/sqlite-queries.ts`](../../server/src/sqlite-queries.ts). The seam
 * exists so that replacing the engine changes what a query *is* and never what a
 * row *means*; the way to honour that is for the two files to be boringly alike.
 */

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
export function windowFilter(query: WindowQuery): Filter {
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

export function componentFilter(query: ComponentWindowQuery): Filter {
  const base = windowFilter(query);
  return {
    sql: `${base.sql} AND component = ?`,
    params: [...base.params, query.component],
  };
}

export function subjectFilter(query: SubjectWindowQuery): Filter {
  const base = windowFilter(query);
  return {
    sql: `${base.sql} AND subject = ?`,
    params: [...base.params, query.subject],
  };
}

export function tokenFilter(query: TokenWindowQuery): Filter {
  const base = windowFilter(query);
  // Only values a write carrying an approval left behind. A journey through
  // values that were never shipped describes the review process rather than the
  // product, and every number in it looks real.
  return {
    sql: `${base.sql} AND token = ? AND accepted = 1`,
    params: [...base.params, query.token],
  };
}

export function areaFilter(query: AreaQuery): Filter {
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
export async function currentRows(db: D1Like, query: SubjectsQuery): Promise<readonly Observation[]> {
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
 * The newest recorded value per token, and only the newest.
 *
 * Transcribed from `sqlite-queries.ts`, window function and tie-break included.
 * No `LIMIT`, for the reason `currentRows` has none: a token missing from the
 * answer reads as one nobody has recorded, and the run then writes a value that
 * did not move.
 */
export async function currentTokenRows(
  db: D1Like,
  query: BackendQuery,
): Promise<readonly TokenValue[]> {
  const clauses: string[] = [];
  const params: D1Value[] = [];
  scopeInto(query, clauses, params);

  const where = clauses.map((clause) => ` AND ${clause}`).join('');

  const rows = await db
    .prepare(
      'SELECT * FROM (SELECT *, ROW_NUMBER() OVER (' +
        'PARTITION BY project, token ORDER BY at_ms DESC, rowid DESC) AS recency ' +
        `FROM token_values WHERE 1 = 1${where}) WHERE recency = 1`,
    )
    .bind(...params)
    .all<Row>();

  return rows.results.map(toTokenValue);
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
export async function slice<T>(
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
export async function reachRows(db: D1Like, query: ComponentWindowQuery): Promise<ReachRows> {
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
