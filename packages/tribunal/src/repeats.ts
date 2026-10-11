import type { D1Like, D1PreparedLike } from './bindings.js';
import { decisionOf } from './review-summary.js';
import { number, optionalText, text, type Row } from './review-rows.js';
import type { RepeatedIn, Repeats } from './review-types.js';

/** How many earlier builds a subject names. `count` still says how many there were. */
export const NAMED = 8;

/**
 * For every subject of one build that kept a candidate a reviewer decides on, the earlier builds of
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
 * Only a render a reviewer decides on asks. A push keeps an unchanged subject's
 * image too, as a second copy of its baseline, so that key is the same in every
 * build since the baseline was set: asked of it, the lookup would join every
 * retained build for nearly every subject, to say what the verdict already does.
 *
 * The joins are `CROSS JOIN` because SQLite runs those in the order written.
 * Left to choose, without statistics, it starts from every subject row of the
 * project, or walks every earlier build per subject; in this order it reads
 * this build's subjects, then one probe of the key index per subject.
 *
 * Decided builds come first, the latest decision leading, because the decision
 * is what a reviewer acts on: eight builds nobody looked at must not push out
 * the one that rejected this image.
 *
 * `subject` narrows the answer to one render, for a decision being recorded: an
 * equality rather than a nullable parameter, so that read probes the primary
 * key instead of walking every subject of the build.
 */
export function repeatsStatement(
  db: D1Like,
  project: string,
  build: string,
  subject?: string,
): D1PreparedLike {
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
            ${subject === undefined ? '' : 'AND here.subject = ?'}
            AND here.verdict NOT IN ('unchanged', 'ignored')
            AND (earlier.at_ms, earlier.rowid) < (this.at_ms, this.rowid)
       )
        WHERE place <= ?
        ORDER BY subject, place`,
    )
    .bind(project, build, ...(subject === undefined ? [] : [subject]), NAMED);
}

/**
 * The rows of {@link repeatsStatement}, by subject.
 *
 * A subject a reviewer decides on, with a candidate and no row here, kept an
 * image that no earlier build still on record kept; the caller answers that with
 * an empty {@link Repeats}.
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

/**
 * Whether a render with this verdict asks which earlier builds kept its image:
 * only one a reviewer decides on. Its SQL twin is the `verdict` filter in
 * {@link repeatsStatement}.
 */
export function asksRepeats(verdict: string): boolean {
  return verdict !== 'unchanged' && verdict !== 'ignored';
}

/** What a subject that kept a candidate says when no earlier build kept it. */
export const UNREPEATED: Repeats = { count: 0, builds: [] };

/** The title of the concern an approval of an image `rejected` rejected opens. */
export function acceptanceTitle(rejected: string): string {
  return `Approved the image build ${rejected} rejected`;
}

/**
 * The earlier build whose rejection an approval of `subject` in `build` would
 * accept, or `undefined`.
 *
 * The latest decision on the same image is what is accepted, so an image
 * rejected and then approved elsewhere accepts nothing new. Neither does a build
 * that already opened the concern: approving there again, whatever was decided
 * in between, is the same reviewer's mind, not a second defect. Read from the
 * concerns rather than from this build's decisions, so an approval whose concern
 * never got written opens it on the next try.
 */
export async function rejectionAccepted(
  db: D1Like,
  project: string,
  build: string,
  subject: string,
): Promise<RepeatedIn | undefined> {
  const earlier = await repeatsStatement(db, project, build, subject).all<Row>();
  const lead = repeatsFrom(earlier.results).get(subject)?.builds[0];
  if (lead?.decision?.decision !== 'rejected') return undefined;
  const raised = await db
    .prepare('SELECT 1 FROM concerns WHERE project = ? AND build = ? AND subject = ? AND title = ?')
    .bind(project, build, subject, acceptanceTitle(lead.build))
    .first<Row>();
  return raised === null ? lead : undefined;
}
