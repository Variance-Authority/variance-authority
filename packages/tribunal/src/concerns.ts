import type { D1Like, D1PreparedLike } from './bindings.js';
import {
  CONCERN_STATES,
  type Concern,
  type ConcernEvent,
  type ConcernQuery,
  type ConcernRegion,
  type ConcernState,
  type ConcernTally,
  type MoveConcern,
  type RaiseConcern,
} from './concern-types.js';
import { ReviewError, instant, number, optionalText, text, type Row } from './review-rows.js';

/**
 * "Looks suspicious", kept.
 *
 * A reviewer looking at a change has two questions and the docket used to hold
 * one. Whether the pixels become the baseline is a decision, and it is final in
 * the way promotion is. Whether something is *wrong* is often not answerable on
 * the page — it needs a person, a branch, a second build — and the only places
 * to put it were a rejection, which blocks a change that may be fine, or a note
 * on an approval, which is gone from view the moment the baseline moves.
 *
 * So a concern is its own record. It names the render, optionally a rectangle
 * of it, what the reviewer pointed at, and a trail of states, and it lasts as
 * long as the subject does: the sweep never removes it, and every later build of
 * the subject shows it until somebody resolves it.
 *
 * ## Two tables, both append-only
 *
 * The concern is what was suspected; it never changes. Its state is a trail,
 * because "who resolved this, and why" is the question the next reviewer asks,
 * and the latest row is the answer. The triggers that refuse an `UPDATE` are the
 * same ones `decisions` carries, for the same reason.
 */
export interface ConcernStore {
  raise(input: RaiseConcern): Promise<Concern>;
  move(id: number, input: MoveConcern): Promise<Concern>;
  list(query?: ConcernQuery): Promise<readonly Concern[]>;
  /** How many concerns stand in each state on the subjects this build showed. */
  tally(build: string): Promise<ConcernTally>;
}

export interface ConcernOptions {
  readonly db: D1Like;
  readonly project: string;
  readonly now?: () => Date;
}

export function createConcernStore({ db, project, now = () => new Date() }: ConcernOptions): ConcernStore {
  /**
   * One step of a trail. `concern` is the id, or `null` for the concern the
   * statement before it in the same batch inserted — which is how raising writes
   * a concern and its first step as one transaction.
   */
  function step(concern: number | null, input: MoveConcern, at: string): D1PreparedLike {
    return db
      .prepare(
        `INSERT INTO concern_events (project, concern, state, note, hypothesis, moved_by, at, at_ms)
         VALUES (?, ${concern === null ? 'last_insert_rowid()' : '?'}, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        project,
        ...(concern === null ? [] : [concern]),
        stateOf(input.state),
        present(input.note) ?? null,
        present(input.hypothesis) ?? null,
        input.by,
        at,
        instant(at, 'a concern'),
      );
  }

  /** `where` names columns of `concerns` as `c`, which both statements alias. */
  async function read(where: string, values: readonly (string | number)[]): Promise<readonly Concern[]> {
    const [concerns, events] = await db.batch<Row>([
      db
        .prepare(`SELECT c.* FROM concerns c WHERE c.project = ?${where} ORDER BY c.id`)
        .bind(project, ...values),
      db
        .prepare(
          `SELECT e.* FROM concern_events e JOIN concerns c ON c.id = e.concern
            WHERE e.project = ? AND c.project = ?${where}
            ORDER BY e.seq`,
        )
        .bind(project, project, ...values),
    ]);
    const trail = new Map<number, ConcernEvent[]>();
    for (const row of events?.results ?? []) {
      const id = number(row, 'concern', 'a concern event');
      trail.set(id, [...(trail.get(id) ?? []), toEvent(row)]);
    }
    return (concerns?.results ?? []).map((row) => toConcern(row, trail.get(number(row, 'id', 'a concern')) ?? []));
  }

  async function one(id: number): Promise<Concern> {
    const [found] = await read(' AND c.id = ?', [id]);
    if (found === undefined) {
      throw new ReviewError(`this project raised no concern ${id}`);
    }
    return found;
  }

  return {
    async raise(input): Promise<Concern> {
      const title = input.title.trim();
      if (title === '') throw new ReviewError('a concern needs a title: it is what the docket lists');
      const region = input.region === undefined ? undefined : regionOf(input.region);
      const state = stateOf(input.state ?? 'open');

      const subject = await db
        .prepare('SELECT 1 FROM build_subjects WHERE project = ? AND build = ? AND subject = ?')
        .bind(project, input.build, input.subject)
        .first<Row>();
      if (subject === null) {
        throw new ReviewError(
          `build "${input.build}" has no subject "${input.subject}". A concern names a render ` +
            'somebody looked at, and this build never showed that one',
        );
      }

      const at = now().toISOString();
      // Both rows or neither: a concern with no first step has no state, and the
      // triggers would never let it be removed.
      const [inserted] = await db.batch<Row>([
        db
          .prepare(
            `INSERT INTO concerns (project, build, subject, title, region, evidence, raised_by, at, at_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          )
          .bind(
            project,
            input.build,
            input.subject,
            title,
            region === undefined ? null : JSON.stringify(region),
            JSON.stringify(input.evidence ?? []),
            input.by,
            at,
            instant(at, 'a concern'),
          ),
        step(null, { ...input, state }, at),
      ]);
      const row = inserted?.results[0];
      if (row === undefined) throw new ReviewError('the database recorded a concern and returned no id for it');
      const id = number(row, 'id', 'a raised concern');

      return one(id);
    },

    async move(id, input): Promise<Concern> {
      stateOf(input.state);
      await one(id);
      await step(id, input, now().toISOString()).run();
      return one(id);
    },

    list,

    async tally(build): Promise<ConcernTally> {
      const tally = { open: 0, investigating: 0, resolved: 0 };
      for (const concern of await list({ seenIn: build })) tally[concern.state] += 1;
      return tally;
    },
  };

  async function list(query: ConcernQuery = {}): Promise<readonly Concern[]> {
    let where = '';
    const values: string[] = [];
    if (query.subject !== undefined) {
      where += ' AND c.subject = ?';
      values.push(query.subject);
    }
    if (query.seenIn !== undefined) {
      where += ' AND c.subject IN (SELECT subject FROM build_subjects WHERE project = c.project AND build = ?)';
      values.push(query.seenIn);
    }
    const all = await read(where, values);
    return query.state === undefined ? all : all.filter((concern) => concern.state === query.state);
  }
}

function toEvent(row: Row): ConcernEvent {
  const note = optionalText(row, 'note', 'a concern event');
  const hypothesis = optionalText(row, 'hypothesis', 'a concern event');
  return {
    state: stateOf(text(row, 'state', 'a concern event')),
    by: text(row, 'moved_by', 'a concern event'),
    at: text(row, 'at', 'a concern event'),
    ...(note !== undefined ? { note } : {}),
    ...(hypothesis !== undefined ? { hypothesis } : {}),
  };
}

function toConcern(row: Row, events: readonly ConcernEvent[]): Concern {
  const last = events.at(-1);
  if (last === undefined) {
    // Raising writes both rows; a concern with no trail is a write that stopped
    // half way, and calling it `open` would invent the half that is missing.
    throw new ReviewError(`concern ${String(row['id'])} has no recorded state`);
  }
  const region = optionalText(row, 'region', 'a concern');
  return {
    id: number(row, 'id', 'a concern'),
    build: text(row, 'build', 'a concern'),
    subject: text(row, 'subject', 'a concern'),
    title: text(row, 'title', 'a concern'),
    ...(region !== undefined ? { region: regionOf(JSON.parse(region) as unknown) } : {}),
    evidence: evidenceOf(JSON.parse(text(row, 'evidence', 'a concern')) as unknown),
    by: text(row, 'raised_by', 'a concern'),
    at: text(row, 'at', 'a concern'),
    state: last.state,
    events,
  };
}

function stateOf(value: unknown): ConcernState {
  if (CONCERN_STATES.includes(value as ConcernState)) return value as ConcernState;
  throw new ReviewError(`a concern's state is one of ${CONCERN_STATES.join(', ')}, not ${JSON.stringify(value)}`);
}

/** Validated in and out: a stored rectangle with no area would draw nothing and say it did. */
export function regionOf(value: unknown): ConcernRegion {
  const record = (value ?? {}) as Record<string, unknown>;
  const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((key) => record[key]);
  const whole = [x, y, width, height].every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0);
  if (!whole || (width as number) === 0 || (height as number) === 0) {
    throw new ReviewError('a concern region is whole, non-negative x, y, width and height, with an area');
  }
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function evidenceOf(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new ReviewError('a concern has evidence that is not a list of names');
  }
  return value;
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}
