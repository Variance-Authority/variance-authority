import { identityDigest } from '@variance-authority/core';
import type { D1Like } from './bindings.js';
import { readChangelog, recordApproval } from './changelog.js';
import { docket, latestDecisions, summarize, toNotObserved, toSubjectView } from './review-read.js';
import { ReviewError, instant, number, optionalText, text, type Row } from './review-rows.js';
import type {
  BuildDetail,
  BuildSummary,
  DecisionRecord,
  ReviewOptions,
  ReviewStore,
  SweepReport,
} from './review-types.js';
import { promote, store, type StoredKeys } from './review-write.js';
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
 * the bucket are in [`review-write.ts`](./review-write.ts); reading a build back
 * out is [`review-read.ts`](./review-read.ts). What is left here is the store
 * itself — the order the writes happen in, and what each operation refuses.
 */

export type {
  BuildDetail,
  BuildIngest,
  BuildSummary,
  CandidateImage,
  Cause,
  Coverage,
  Decision,
  DecisionRecord,
  ReviewOptions,
  ReviewStore,
  SubjectImages,
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

export function createReviewStore(options: ReviewOptions): ReviewStore {
  const { db, bucket, project } = options;
  const now = options.now ?? ((): Date => new Date());
  const baselines = createBucketStore(options);

  return {
    async ingest(build): Promise<void> {
      const { report } = build;
      if (report.runVersion !== 1) {
        // The same refusal `readRunReport` makes, for the same reason: an agent
        // edits code on these answers, and a partly-understood report produces
        // confident sentences about fields that were never there.
        throw new ReviewError(
          `build "${build.build}" carries a report at runVersion ${String(report.runVersion)}; ` +
            'this deployment understands 1. Refusing it rather than storing a shape whose ' +
            'fields it would then misread',
        );
      }

      const identity = report.identity;
      const at = report.at;
      const images = build.images ?? {};

      // Objects first, rows second — the same order and the same argument as the
      // baseline store's `put`. An object nothing points at is invisible and is
      // swept; a row pointing at nothing is a build that throws whenever anybody
      // opens it.
      const written: { readonly subject: string; readonly keys: StoredKeys }[] = [];
      for (const observation of report.observations) {
        written.push({
          subject: observation.subject,
          keys: await store(bucket, project, build.build, observation.subject, images[observation.subject]),
        });
      }

      const statements = [
        db
          .prepare(
            `INSERT OR REPLACE INTO builds
               (project, build, "commit", branch, intent, at, at_ms, identity, identity_digest,
                retention, run_version, says_not_observed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            project,
            build.build,
            build.commit,
            build.branch ?? null,
            report.intent ?? null,
            at,
            instant(at, `build "${build.build}"`),
            JSON.stringify(identity),
            identityDigest(identity),
            report.retention,
            report.runVersion,
            report.notObserved === undefined ? 0 : 1,
          ),
      ];

      for (const [index, observation] of report.observations.entries()) {
        const keys = written[index]?.keys ?? {};
        const after = images[observation.subject]?.after;
        statements.push(
          db
            .prepare(
              `INSERT OR REPLACE INTO build_subjects
                 (project, build, subject, verdict, because, changed_pixels, regions, truncated,
                  missing_fonts, findings, before_key, after_key, diff_key,
                  candidate_document_digest, candidate_width, candidate_height,
                  candidate_missing_fonts)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              project,
              build.build,
              observation.subject,
              observation.verdict,
              observation.because,
              observation.changedPixels,
              JSON.stringify(observation.regions),
              observation.truncated === undefined ? null : JSON.stringify(observation.truncated),
              observation.missingFonts === undefined
                ? null
                : JSON.stringify(observation.missingFonts),
              // `null` and `'[]'` are different claims and are stored as
              // different values: nothing inspected this render, versus this
              // render was inspected and was clean.
              observation.findings === undefined ? null : JSON.stringify(observation.findings),
              keys.before ?? null,
              keys.after ?? null,
              keys.diff ?? null,
              after?.documentDigest ?? null,
              after?.width ?? null,
              after?.height ?? null,
              after === undefined ? null : JSON.stringify(after.missingFonts),
            ),
        );
      }

      for (const entry of report.notObserved ?? []) {
        statements.push(
          db
            .prepare(
              `INSERT OR REPLACE INTO build_not_observed (project, build, subject, kind, because)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(project, build.build, entry.subject, entry.kind, entry.because),
        );
      }

      await db.batch(statements);
    },

    async builds(limit = 50): Promise<readonly BuildSummary[]> {
      const listed = await db
        .prepare('SELECT * FROM builds WHERE project = ? ORDER BY at_ms DESC LIMIT ?')
        .bind(project, limit)
        .all<Row>();

      const summaries: BuildSummary[] = [];
      for (const row of listed.results) {
        summaries.push(await summarize(db, project, row));
      }
      return summaries;
    },

    async build(id): Promise<BuildDetail | null> {
      const row = await db
        .prepare('SELECT * FROM builds WHERE project = ? AND build = ?')
        .bind(project, id)
        .first<Row>();
      if (row === null) return null;

      const summary = await summarize(db, project, row);
      const subjectRows = await db
        .prepare('SELECT * FROM build_subjects WHERE project = ? AND build = ? ORDER BY subject')
        .bind(project, id)
        .all<Row>();
      const decisions = await latestDecisions(db, project, id);
      const skipped = await db
        .prepare('SELECT * FROM build_not_observed WHERE project = ? AND build = ? ORDER BY subject')
        .bind(project, id)
        .all<Row>();

      const subjects = subjectRows.results.map((subject) =>
        toSubjectView(subject, decisions.get(text(subject, 'subject', 'a build subject')) ?? null),
      );

      return {
        ...summary,
        subjects,
        notObserved: skipped.results.map(toNotObserved),
        causes: docket(subjects),
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
      if (!Number.isFinite(keepDays) || keepDays < 0) {
        throw new ReviewError(
          `a retention window of ${String(keepDays)} days is not a window. Pass the number of ` +
            'days of builds to keep; 0 keeps none',
        );
      }

      const cutoff = now().getTime() - keepDays * 86_400_000;
      const expired = await db
        .prepare('SELECT build FROM builds WHERE project = ? AND at_ms < ?')
        .bind(project, cutoff)
        .all<Row>();

      const ids = expired.results.map((row) => text(row, 'build', 'a build'));
      if (ids.length === 0) return { builds: 0, subjects: 0, objects: 0, decisions: 0 };

      let objects = 0;
      let subjects = 0;
      let decisions = 0;

      for (const id of ids) {
        const rows = await db
          .prepare('SELECT before_key, after_key, diff_key FROM build_subjects WHERE project = ? AND build = ?')
          .bind(project, id)
          .all<Row>();

        const keys = rows.results.flatMap((row) =>
          (['before_key', 'after_key', 'diff_key'] as const)
            .map((column) => optionalText(row, column, 'a build subject'))
            .filter((key): key is string => key !== undefined),
        );

        if (keys.length > 0) await bucket.delete(keys);
        objects += keys.length;
        subjects += rows.results.length;

        const counted = await db
          .prepare('SELECT COUNT(*) AS n FROM decisions WHERE project = ? AND build = ?')
          .bind(project, id)
          .first<Row>();
        decisions += number(counted ?? {}, 'n', 'a decision count');

        // `decisions` carries a permanence trigger and is deliberately not swept:
        // a promoted baseline whose approval was deleted is a change nobody can
        // attribute to anyone. What expires is what a build kept to be *looked
        // at*, which is images and the verdicts beside them.
        await db
          .prepare('DELETE FROM build_subjects WHERE project = ? AND build = ?')
          .bind(project, id)
          .run();
        await db
          .prepare('DELETE FROM build_not_observed WHERE project = ? AND build = ?')
          .bind(project, id)
          .run();
        await db.prepare('DELETE FROM builds WHERE project = ? AND build = ?').bind(project, id).run();
      }

      return { builds: ids.length, subjects, objects, decisions };
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
