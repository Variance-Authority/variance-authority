import type { D1Like, D1PreparedLike } from './bindings.js';
import { decisionOf } from './review-summary.js';
import { number, optionalText, text, type Row } from './review-rows.js';
import type { RepeatedIn, Repeats } from './review-types.js';

/** How many earlier builds a subject names. `count` still says how many there were. */
export const NAMED = 8;

/**
 * For every subject of one build that kept a candidate, the earlier builds of
 * this project and this render identity in which the same subject kept the same
 * candidate. A baseline is kept per identity, so a decision made on another
 * engine or platform moved another baseline, and says nothing about this one.
 *
 * A candidate's key is the SHA-256 of its bytes, so an equal key is the same
 * picture, and nothing new is stored to answer this. `build_subjects_after`
 * finds the rows with a key, which sweep added for its own reasons; the
 * decision each build ended on is the newest `seq` under `decisions_latest`, as
 * `latestDecisionsStatement` reads it for one build.
 * Earlier is the order `previous` uses, `(at_ms, rowid)`, so two builds pushed
 * in one millisecond are still one before the other.
 *
 * The joins are `CROSS JOIN` because SQLite runs those in the order written.
 * Left to choose, without statistics, it starts from every subject row of the
 * project, or walks every earlier build per subject; in this order it reads
 * this build's subjects, then one probe of the key index per subject.
 *
 * Decided builds come first, the latest decision leading, because the decision
 * is what a reviewer acts on: eight builds nobody looked at must not push out
 * the one that rejected this image.
 */
export function repeatsStatement(db: D1Like, project: string, build: string): D1PreparedLike {
  return db
    .prepare(
      `SELECT subject, build, at, decision, decided_by, note, decided_at, count FROM (
         SELECT here.subject AS subject, there.build AS build, earlier.at AS at,
                d.decision AS decision, d.decided_by AS decided_by, d.note AS note,
                d.at AS decided_at,
                COUNT(*) OVER (PARTITION BY here.subject) AS count,
                ROW_NUMBER() OVER (
                  PARTITION BY here.subject
                  ORDER BY d.seq IS NULL, d.seq DESC, earlier.at_ms DESC, earlier.rowid DESC
                ) AS place
           FROM build_subjects here
           CROSS JOIN builds this ON this.project = here.project AND this.build = here.build
           CROSS JOIN build_subjects there
             ON there.after_key = here.after_key
            AND there.project = here.project
            AND there.subject = here.subject
           CROSS JOIN builds earlier ON earlier.project = there.project AND earlier.build = there.build
            AND earlier.identity_digest = this.identity_digest
           LEFT JOIN decisions d ON d.seq = (
             SELECT MAX(seq) FROM decisions
              WHERE project = there.project AND build = there.build AND subject = there.subject)
          WHERE here.project = ? AND here.build = ? AND here.after_key IS NOT NULL
            AND (earlier.at_ms, earlier.rowid) < (this.at_ms, this.rowid)
       )
        WHERE place <= ?
        ORDER BY subject, place`,
    )
    .bind(project, build, NAMED);
}

/**
 * The rows of {@link repeatsStatement}, by subject.
 *
 * A subject with a candidate and no row here kept an image that no earlier build
 * still on record kept; the caller answers that with an empty {@link Repeats}.
 */
export function repeatsFrom(rows: readonly Row[]): ReadonlyMap<string, Repeats> {
  const found = new Map<string, { count: number; builds: RepeatedIn[] }>();
  const what = 'an earlier build with the same image';
  for (const row of rows) {
    const subject = text(row, 'subject', what);
    const entry = found.get(subject) ?? { count: number(row, 'count', what), builds: [] };
    entry.builds.push({
      build: text(row, 'build', what),
      at: text(row, 'at', what),
      decision: optionalText(row, 'decision', what) === undefined ? null : decisionOf(row, 'decided_at'),
    });
    found.set(subject, entry);
  }
  return found;
}

/** What a subject that kept a candidate says when no earlier build kept it. */
export const UNREPEATED: Repeats = { count: 0, builds: [] };
