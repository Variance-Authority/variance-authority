import { discard, unreferenced } from './objects.js';
import { ReviewError, number, text, type Row } from './review-rows.js';
import type { D1Like, R2Like } from './bindings.js';
import type { SweepReport } from './review-types.js';

/**
 * What a retention window removes, and the two things it refuses to remove.
 *
 * Apart from [`review.ts`](./review.ts) because it is the one operation there
 * that destroys anything, and the argument for each exception is longer than the
 * code that makes it. Every other entry point can be wrong and be re-read; this
 * one can be wrong and leave a reviewer with a change nobody can approve.
 */
export async function sweepProject(
  {
    db,
    bucket,
    project,
    now,
  }: {
    readonly db: D1Like;
    readonly bucket: R2Like;
    readonly project: string;
    readonly now: () => Date;
  },
  keepDays: number,
): Promise<SweepReport> {
  if (!Number.isFinite(keepDays) || keepDays < 0) {
    throw new ReviewError(
      `a retention window of ${String(keepDays)} days is not a window. Pass the number of ` +
        'days of builds to keep; 0 keeps none',
    );
  }

  const cutoff = now().getTime() - keepDays * 86_400_000;
  const expired = await db
    .prepare('SELECT build, retention FROM builds WHERE project = ? AND at_ms < ?')
    .bind(project, cutoff)
    .all<Row>();

  let objects = 0;
  let subjects = 0;
  let decisionsKept = 0;
  let held = 0;
  let builds = 0;

  for (const row of expired.results) {
    const id = text(row, 'build', 'a build');

    // A build nobody has finished reviewing outlives its window.
    //
    // The sweep used to count the decisions a build carried and then delete
    // its images anyway, which took the `after` out from under every
    // `changed` subject still waiting for somebody: `decide` then refused
    // with "the bucket has no such object", and the change became
    // permanently unapprovable through this service — the one operation the
    // whole deployment exists for, removed by the retention policy, quietly.
    //
    // `ephemeral` builds are exempt because there is nothing to promote:
    // both of their images were painted in the one run and compared to each
    // other (ADR-0011), so no decision about one can reach a stored
    // baseline. Only a `durable` build has an approval that changes
    // anything.
    //
    // Held builds are reported rather than hidden. A number that climbs is a
    // review queue nobody is working, which is a fact about the team and not
    // about this function — and it is strictly better than the alternative,
    // where the queue is cleared by destroying the evidence.
    if (text(row, 'retention', 'a build') !== 'ephemeral' && (await pending(db, project, id)) > 0) {
      held += 1;
      continue;
    }

    const kept = await db
      .prepare('SELECT COUNT(*) AS n FROM build_subjects WHERE project = ? AND build = ?')
      .bind(project, id)
      .first<Row>();
    subjects += number(kept ?? {}, 'n', 'a subject count');

    const counted = await db
      .prepare('SELECT COUNT(*) AS n FROM decisions WHERE project = ? AND build = ?')
      .bind(project, id)
      .first<Row>();
    decisionsKept += number(counted ?? {}, 'n', 'a decision count');

    // One batch, because these nine tables are one build. Run one statement
    // at a time, a failure in the middle leaves a build whose subjects are
    // gone and whose reach rows are not — a row set no page can render and
    // no later sweep will revisit, since the `builds` row it selects on goes
    // last.
    //
    // `decisions` carries a permanence trigger and is deliberately not
    // swept: a promoted baseline whose approval was deleted is a change
    // nobody can attribute to anyone. What expires is what a build kept to
    // be *looked at*, which is images and the verdicts beside them.
    await db.batch(
      [
        'build_subjects',
        'build_not_observed',
        'build_variations',
        'build_composition',
        'build_movements',
        'build_reach_subjects',
        'build_reach',
        'build_journeys',
        'builds',
      ].map((table) =>
        db.prepare(`DELETE FROM ${table} WHERE project = ? AND build = ?`).bind(project, id),
      ),
    );
    builds += 1;
  }

  // The render cache, on the same window.
  //
  // Nothing used to remove one of these rows, ever — a store whose only
  // bounded table was the one holding builds. A cache entry is pure
  // optimisation: the loss of one costs a re-render of a document nothing
  // has asked for in the whole retention period, which is the cheapest thing
  // in this file to be wrong about.
  const cachedRows = await db
    .prepare('SELECT COUNT(*) AS n FROM render_cache WHERE project = ? AND at_ms < ?')
    .bind(project, cutoff)
    .first<Row>();
  const cached = number(cachedRows ?? {}, 'n', 'a cache count');
  if (cached > 0) {
    await db
      .prepare('DELETE FROM render_cache WHERE project = ? AND at_ms < ?')
      .bind(project, cutoff)
      .run();
  }

  // The bytes, last, and never as "this build's images".
  //
  // Images are stored by content now, so the object a build pointed at is
  // routinely the baseline it was promoted to and the `before` of every run
  // since. Deleting per build would delete a live baseline; the ledger is
  // asked instead which keys nothing refers to any more, which also collects
  // the objects written before a crash took their row — the orphans
  // `store.ts` has always promised the sweep would take and that nothing
  // could previously even name, R2 having no listing here.
  const collectable = await unreferenced(db, project, cutoff);
  await discard(db, bucket, project, collectable);
  objects = collectable.length;

  return { builds, held, subjects, objects, cached, decisionsKept };
}

/**
 * How many of this build's subjects still need somebody, counted in SQL.
 *
 * The same definition `summarize` uses — a verdict that asks for review and no
 * decision against it — and deliberately not a call to `summarize`, which reads
 * eight tables to answer a question the sweep asks once per expired build.
 */
async function pending(db: D1Like, project: string, build: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM build_subjects s
        WHERE s.project = ? AND s.build = ?
          AND s.verdict IN ('changed', 'new', 'incomparable')
          AND NOT EXISTS (
                SELECT 1 FROM decisions d
                 WHERE d.project = s.project AND d.build = s.build AND d.subject = s.subject)`,
    )
    .bind(project, build)
    .first<Row>();

  return number(row ?? {}, 'n', 'a pending count');
}
