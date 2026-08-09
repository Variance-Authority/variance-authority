import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';
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
} from './backend.js';
import { instant, number, text } from './sqlite-rows.js';

/**
 * The predicates, and the two reads whose shape is not a plain `SELECT *`.
 *
 * Separate from the connection because none of it touches one: every function
 * here takes a `Prepare` and returns rows, so what is being tested when these are
 * tested is the SQL, not the file it ran against. Keeping it apart is also what
 * makes the caching in `createSqliteBackend` legible — the statements it caches
 * are assembled here, per query, and an unscoped question and a project-scoped one
 * really are different statements.
 */

export type Prepare = (sql: string) => {
  get(params: Record<string, SQLInputValue>): Record<string, SQLOutputValue> | undefined;
  all(params: Record<string, SQLInputValue>): Record<string, SQLOutputValue>[];
  run(params: Record<string, SQLInputValue>): unknown;
};

/** A `WHERE` tail and the bindings it names, assembled but not yet run. */
export interface Filter {
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
export function windowFilter(query: WindowQuery): Filter {
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

export function componentFilter(query: ComponentWindowQuery): Filter {
  const base = windowFilter(query);
  return {
    sql: `${base.sql} AND component = $component`,
    params: { ...base.params, $component: query.component },
  };
}

export function tokenFilter(query: TokenWindowQuery): Filter {
  const base = windowFilter(query);
  return {
    // Only values a write carrying an approval left behind; see
    // `carriesAnApproval`.
    sql: `${base.sql} AND token = $token AND accepted = 1`,
    params: { ...base.params, $token: query.token },
  };
}

export function subjectFilter(query: SubjectWindowQuery): Filter {
  const base = windowFilter(query);
  return {
    sql: `${base.sql} AND subject = $subject`,
    params: { ...base.params, $subject: query.subject },
  };
}

export function areaFilter(query: AreaQuery): Filter {
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

/**
 * One row per live scope in the named subjects: the newest, and only the newest.
 *
 * A window function rather than SQLite's `MAX()`-picks-the-row special case,
 * because that case says nothing about ties and two rows can share an instant —
 * a run that recorded two profiles stamps both from one clock read. `rowid` as
 * the second key makes the choice the later *write*, which is the only ordering
 * the store actually has when the instants agree.
 *
 * There is no `LIMIT` here and there must never be one. Every other read in this
 * file caps and reports what it left out; a cap here would hand a run a `previous`
 * set with a hole in it, and a hole is indistinguishable from a hash that was
 * never recorded — so the run appends a change that did not happen, to an
 * append-only store, and every rate over that window is wrong from then on. The
 * question is bounded instead: `MAX_CURRENT_SUBJECTS` names how many subjects one
 * request may ask about, and the client splits a longer list.
 */
export function currentRows(prepare: Prepare, query: SubjectsQuery): Record<string, SQLOutputValue>[] {
  const subjects = [...new Set(query.subjects)];
  if (subjects.length === 0) return [];

  const clauses: string[] = [];
  const params: Record<string, SQLInputValue> = {};
  scopeInto(query, clauses, params);

  const placeholders = subjects.map((subject, index) => {
    params[`$subject${index}`] = subject;
    return `$subject${index}`;
  });
  clauses.push(`subject IN (${placeholders.join(', ')})`);

  const where = clauses.map((clause) => ` AND ${clause}`).join('');

  return prepare(
    'SELECT * FROM (SELECT *, ROW_NUMBER() OVER (' +
      'PARTITION BY project, subject, component, band, profile ' +
      'ORDER BY at_ms DESC, rowid DESC) AS recency ' +
      `FROM observations WHERE 1 = 1${where}) WHERE recency = 1`,
  ).all(params);
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
export function slice<Row>(
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
export function reachRows(prepare: Prepare, query: ComponentWindowQuery): ReachRows {
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
