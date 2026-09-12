import type { D1Like, D1PreparedLike } from './bindings.js';
import { readChangelog, recordApproval } from './changelog.js';
import {
  docket,
  toDeclarations,
  toNotObserved,
  toMovement,
  toPlacement,
  toJourneys,
  toReach,
  toSubjectView,
  toVariation,
} from './review-read.js';
import {
  decisionsFrom,
  latestDecisionsStatement,
  newestBuilds,
  oneBuild,
  summarize,
  summaryCounts,
  summaryStatements,
} from './review-summary.js';
import { ingestBuild } from './review-ingest.js';
import { sweepProject } from './review-sweep.js';
import { ReviewError, instant, optionalText, text, type Row } from './review-rows.js';
import type {
  BuildDetail,
  BuildSummary,
  DecisionRecord,
  ReviewOptions,
  ReviewStore,
  SweepReport,
} from './review-types.js';
import { have as heldObjects } from './objects.js';
import { promote } from './review-write.js';
import type { TribunalChangelog } from './changelog.js';
import { createBucketStore } from './store.js';

/**
 * The half [ADR-0019](../../../docs/context/adr/0019-one-comment-that-leads-with-causes.md) put out of
 * scope: somewhere a change can be looked at, and somewhere a decision about it
 * survives.
 *
 * ## What a build is
 *
 * A `RunReport` and the images that run kept. Nothing here invents a format — the
 * report is what `variance run` already writes, and the images are what it
 * already saved beside it. A CI job posts one thing it already has.
 *
 * ## Approval promotes; it never records
 *
 * `variance accept` "never produces an image — it promotes one the run already
 * produced", and that rule is the reason this file cannot be a simple flag on a
 * row. A baseline is not pixels: it is pixels **plus** the document digest they
 * were painted from and the identity that painted them, which is the sidecar the
 * cheap `describe` path answers from without moving a byte. So a build carries
 * that metadata per subject, and approving writes it through the same
 * `RasterStore` a run reads.
 *
 * A subject whose candidate was never uploaded therefore **cannot be approved**.
 * The alternative is a surface that re-renders in order to say yes, and a surface
 * that can render can record something nobody looked at.
 *
 * ## Two things that are never collapsed
 *
 * **A coverage list that was never stated is not an empty one.** `RunReport`
 * distinguishes them because a run that planned 300 subjects, failed on 50 and
 * found 250 unchanged produces a report in which every observation is clean.
 * Ingest stores which of the two arrived, and every summary below carries it, so
 * "nothing to review" cannot be printed on the authority of a writer that never
 * said what it skipped.
 *
 * **Findings that were never collected are not an absence of defects.** Same
 * distinction, same reason: `[]` means this render was inspected and was clean,
 * and `undefined` means nothing looked.
 *
 * ## What is next door
 *
 * The shapes are in [`review-types.ts`](./review-types.ts) so that the Worker and
 * the React surface can name them without a D1 binding; the two writes that reach
 * the bucket are in [`review-write.ts`](./review-write.ts); writing a report in is
 * [`review-ingest.ts`](./review-ingest.ts) and reading a build back out is
 * [`review-read.ts`](./review-read.ts). What is left here is the store
 * itself — the order the writes happen in, and what each operation refuses.
 */

export type { BuildIngest, CandidateImage, SubjectImages } from './review-ingest-types.js';
export type {
  BuildDetail,
  BuildSummary,
  Cause,
  Coverage,
  Decision,
  DecisionRecord,
  ReviewOptions,
  ReviewStore,
  SubjectView,
  SweepReport,
} from './review-types.js';
export { ReviewError } from './review-rows.js';
export type {
  ChangelogChange,
  ChangelogRow,
  TribunalChangelog,
  TribunalChangelogQuery,
} from './changelog.js';

/**
 * The store, bound to one project in one database and one bucket.
 *
 * A factory rather than a class because the bindings arrive per request in a
 * Worker: there is no process to hold a connection in, and a module-scope
 * instance would outlive the request that was entitled to it. `project` is
 * closed over rather than passed, so it reaches every statement below and a
 * query cannot read across projects by being written without it.
 */
export function createReviewStore(options: ReviewOptions): ReviewStore {
  const { db, bucket, project } = options;
  const now = options.now ?? ((): Date => new Date());
  const baselines = createBucketStore(options);

  return {
    async ingest(build): Promise<void> {
      await ingestBuild({ db, bucket, project }, build);
    },

    /**
     * Of these digests, which this deployment can already produce.
     *
     * Asked before a push, so a run uploads the images this project has never
     * seen and names the rest. On a suite that did not change that is every
     * image but the new ones — the baseline this deployment handed the run over
     * `/baseline/find` comes back as its own `before`, and re-sending it was
     * always the run paying to tell the store something it said first.
     *
     * Answering touches nothing. A question is not a reference, and treating it
     * as one would let a client keep an object alive forever by asking about it;
     * the object is claimed in `store`, where a build actually points at it.
     */
    async have(digests): Promise<readonly string[]> {
      return await heldObjects(db, project, digests);
    },

    /**
     * The newest builds, summarised — in one round trip, whatever the page size.
     *
     * This used to be a listing query and then `summarize` per row, which is
     * four statements per build issued one after another: 201 of them for a
     * page of fifty, each one a subrequest, all of them serial. The page took
     * three seconds and none of it was query cost.
     *
     * Now the listing and its four aggregates travel in one `batch`. The
     * aggregates do not name the builds they are about — they re-select the
     * same window from `builds_recent` — so the statement count is five and the
     * parameter count is four, at any limit, and D1's ceiling of a hundred
     * bound values is not something a later page size can walk into.
     */
    async builds(limit = 50): Promise<readonly BuildSummary[]> {
      const scope = newestBuilds(project, limit);
      const results = await db.batch<Row>([
        ...summaryStatements(db, project, scope),
        db
          .prepare('SELECT * FROM builds WHERE project = ? ORDER BY at_ms DESC, rowid DESC LIMIT ?')
          .bind(project, limit),
      ]);

      const counts = summaryCounts(results);
      return (results[4]?.results ?? []).map((row) => summarize(project, row, counts));
    },

    /**
     * One build, whole — also in one round trip.
     *
     * Thirteen statements, run one at a time, and two of them were duplicates:
     * `summarize` read the decisions to count them and the page read them again
     * to show them, and `build_not_observed` was counted and then listed. What
     * is left is one batch. The build row itself is in it rather than ahead of
     * it, so "no such build" costs the same trip as reading one — the
     * alternative is a statement whose only job is to decide whether to send
     * the others.
     *
     * `build_reach_subjects` is read unconditionally for the same reason. It
     * used to be skipped when the build carried no reach row, which saved a
     * statement in a batch and cost a whole round trip in every build that did.
     */
    async build(id): Promise<BuildDetail | null> {
      const of = (sql: string): D1PreparedLike => db.prepare(sql).bind(project, id);

      // Named rather than positional. A batch answers in order, and a list of
      // fifteen statements read back by index is one inserted line away from
      // handing `movements` the journeys of the same build — which would parse,
      // and would be wrong on the page rather than in the log.
      const reads = {
        decisions: latestDecisionsStatement(db, project, id),
        build: of('SELECT * FROM builds WHERE project = ? AND build = ?'),
        subjects: of('SELECT * FROM build_subjects WHERE project = ? AND build = ? ORDER BY subject'),
        notObserved: of(
          'SELECT * FROM build_not_observed WHERE project = ? AND build = ? ORDER BY subject',
        ),
        variations: of(
          'SELECT * FROM build_variations WHERE project = ? AND build = ? ORDER BY subject',
        ),
        reach: of('SELECT * FROM build_reach WHERE project = ? AND build = ?'),
        reached: of(
          'SELECT * FROM build_reach_subjects WHERE project = ? AND build = ? ORDER BY subject',
        ),
        journeys: of('SELECT * FROM build_journeys WHERE project = ? AND build = ?'),
        composition: of(
          'SELECT * FROM build_composition WHERE project = ? AND build = ? ORDER BY component',
        ),
        movements: of(
          `SELECT * FROM build_movements WHERE project = ? AND build = ?
            ORDER BY component, subject`,
        ),
        // The run before this one, by the listing's order rather than by the
        // clock. Two runs pushed from one machine share a timestamp to the
        // millisecond, so the tie is broken by arrival — the same total order
        // `builds()` returns, compared as a row value so the query needs
        // nothing the caller would have had to read first.
        //
        // Carried here because the page needs exactly this one string, and the
        // surface used to reach it by fetching the entire builds listing and
        // taking the element after this one: 201 statements, in a second serial
        // wave, for a build id the store answers off an index it already has.
        previous: db
          .prepare(
            `SELECT build FROM builds
              WHERE project = ?
                AND (at_ms, rowid) < (SELECT at_ms, rowid FROM builds
                                       WHERE project = ? AND build = ?)
              ORDER BY at_ms DESC, rowid DESC LIMIT 1`,
          )
          .bind(project, project, id),
      };

      const names = Object.keys(reads) as (keyof typeof reads)[];
      const summaries = summaryStatements(db, project, oneBuild(id));
      const results = await db.batch<Row>([...summaries, ...names.map((name) => reads[name])]);

      const rows = (name: keyof typeof reads): readonly Row[] =>
        results[summaries.length + names.indexOf(name)]?.results ?? [];

      const row = rows('build')[0];
      if (row === undefined) return null;

      const summary = summarize(project, row, summaryCounts(results));
      const decisions = decisionsFrom(rows('decisions'));
      const reachRow = rows('reach')[0];
      const journeyRow = rows('journeys')[0];
      const previous = rows('previous')[0];
      const composition = rows('composition');

      const subjects = rows('subjects').map((subject) =>
        toSubjectView(subject, decisions.get(text(subject, 'subject', 'a build subject')) ?? null),
      );

      return {
        ...summary,
        subjects,
        notObserved: rows('notObserved').map(toNotObserved),
        causes: docket(subjects),
        variations: rows('variations').map(toVariation),
        reach: reachRow === undefined ? null : toReach(reachRow, rows('reached')),
        journeys: journeyRow === undefined ? null : toJourneys(journeyRow),
        previous: previous === undefined ? null : text(previous, 'build', 'a build'),
        // No rows is `null`, not `[]`. A run that produced no semantic snapshots
        // has no graph to join, and an empty list would say the opposite — that
        // the suite was read and found to contain no component at all.
        composition: composition.length === 0 ? null : composition.map(toPlacement),
        movements: rows('movements').map(toMovement),
        declarations: toDeclarations(row),
      };
    },

    async image(build, subject, kind): Promise<ArrayBuffer | null> {
      const row = await db
        .prepare(
          `SELECT before_key, after_key, diff_key FROM build_subjects
            WHERE project = ? AND build = ? AND subject = ?`,
        )
        .bind(project, build, subject)
        .first<Row>();
      if (row === null) return null;

      const key = optionalText(row, `${kind}_key`, 'a build subject');
      if (key === undefined) return null;

      const object = await bucket.get(key);
      // An object a row points at and that is not there is damage, not absence —
      // the same rule the baseline store applies. Here it costs a broken image in
      // a page rather than a destroyed baseline, so it is reported rather than
      // fatal, but it is still not answered as "the run kept none".
      if (object === null) {
        throw new ReviewError(
          `build "${build}" says it kept the ${kind} image for ${subject} at \`${key}\`, and the ` +
            'bucket has no such object. The row and the object are one artifact; one without the ' +
            'other is damage rather than a run that saved nothing',
        );
      }
      return object.arrayBuffer();
    },

    async decide(input): Promise<DecisionRecord> {
      const row = await db
        .prepare('SELECT * FROM build_subjects WHERE project = ? AND build = ? AND subject = ?')
        .bind(project, input.build, input.subject)
        .first<Row>();

      if (row === null) {
        throw new ReviewError(
          `build "${input.build}" has no subject "${input.subject}". Deciding about a subject a ` +
            'build never reported would record an approval nothing can be promoted for',
        );
      }

      const at = now().toISOString();

      // Promotion happens *before* the decision is recorded. The other order can
      // leave an approval on the page whose baseline was never written, and the
      // next run would then report the same change again with the reviewer's name
      // already against it.
      if (input.decision === 'approved') {
        await promote(bucket, baselines, db, project, input.build, input.subject, row);
        // Beside the promotion, and only for one: an approval is the moment a
        // baseline changed, and it is the last moment at which anything still
        // knows what the change was. `build_subjects` expires; this does not.
        await recordApproval(db, project, {
          build: input.build,
          subject: input.subject,
          by: input.by,
          at,
          regions: text(row, 'regions', 'a build subject'),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(await buildContext(db, project, input.build)),
        });
      }

      await db
        .prepare(
          `INSERT INTO decisions (project, build, subject, decision, decided_by, note, at, at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          project,
          input.build,
          input.subject,
          input.decision,
          input.by,
          input.note ?? null,
          at,
          instant(at, 'a decision'),
        )
        .run();

      return {
        decision: input.decision,
        by: input.by,
        at,
        ...(input.note !== undefined ? { note: input.note } : {}),
      };
    },

    async changelog(query): Promise<TribunalChangelog> {
      return readChangelog(db, project, query ?? {});
    },

    async sweep(keepDays): Promise<SweepReport> {
      return await sweepProject({ db, bucket, project, now }, keepDays);
    },
  };
}


/**
 * The two things a changelog entry needs from the build and cannot invent.
 *
 * Read at approval time rather than joined at read time, because the build row
 * is what `sweep` removes. A build that has already gone is not a failure here —
 * its subjects would have gone with it, so there would be nothing to approve —
 * but the read is defended anyway, since an entry attributing a baseline to an
 * empty commit is worse than one that says nothing.
 */
async function buildContext(
  db: D1Like,
  project: string,
  build: string,
): Promise<{ readonly commit: string; readonly intent?: string }> {
  const row = await db
    .prepare('SELECT "commit", intent FROM builds WHERE project = ? AND build = ?')
    .bind(project, build)
    .first<Row>();

  if (row === null) {
    throw new ReviewError(
      `build "${build}" is no longer in this database, so an approval under it could not be ` +
        'attributed to a commit. A changelog entry naming no commit explains nothing',
    );
  }

  const intent = optionalText(row, 'intent', 'a build');
  return {
    commit: text(row, 'commit', 'a build'),
    ...(intent !== undefined ? { intent } : {}),
  };
}
