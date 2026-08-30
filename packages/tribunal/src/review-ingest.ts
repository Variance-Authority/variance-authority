import { identityDigest } from '@variance-authority/core';
import type { D1Like, R2Like } from './bindings.js';
import { ReviewError, instant } from './review-rows.js';
import type { BuildIngest } from './review-types.js';
import { store, type StoredKeys } from './review-write.js';

/**
 * One run report, written into rows.
 *
 * Apart from [`review.ts`](./review.ts) because it is the only operation there
 * that reads a whole `RunReport` — every other one reads a row back out. Five
 * tables move together, and the order they move in is the argument: objects
 * first, rows second, every statement in one `batch`.
 *
 * What this does *not* do is normalise. A report says `undefined` in a dozen
 * places where it could have said `[]` or `false`, and each of those pairs is a
 * distinction somebody downstream reads: a coverage list that was never stated
 * is not an empty one, findings nothing collected are not an absence of defects,
 * and a variation with no parent was not compared and found to differ. Each is
 * stored as `null` in a column that permits it, so reading it back can still
 * tell the two apart.
 */
export async function ingestBuild(
  {
    db,
    bucket,
    project,
  }: { readonly db: D1Like; readonly bucket: R2Like; readonly project: string },
  build: BuildIngest,
): Promise<void> {
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
            retention, run_version, says_not_observed, ignores, sensitivities)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        // Stored whole and stored as absent when absent. A ledger reshaped on the
        // way in would be a second vocabulary for one fact, and a `'[]'` written
        // where the report said nothing would turn a build nobody audited into
        // one that was audited and found clean.
        report.ignores === undefined ? null : JSON.stringify(report.ignores),
        report.sensitivities === undefined ? null : JSON.stringify(report.sensitivities),
      ),
  ];

  for (const [index, observation] of report.observations.entries()) {
    const keys = written[index]?.keys ?? {};
    const after = images[observation.subject]?.after;
    const before = images[observation.subject]?.before;
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO build_subjects
             (project, build, subject, verdict, because, changed_pixels, regions, truncated,
              missing_fonts, findings, signals, ignored, relaxed, moved, before_key, after_key,
              diff_key, candidate_document_digest, candidate_width, candidate_height,
              candidate_missing_fonts, candidate_accessibility,
              baseline_width, baseline_height)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          observation.signals === undefined ? null : JSON.stringify(observation.signals),
          // What decided this subject, when a declaration did. Stored rather
          // than left to the run-level ledger: the ledger says what a rule took
          // across the whole run, and the question a settled list asks is which
          // rule took *this one*. Dropping it made the service report the run as
          // silent about something the run had written down.
          observation.ignored === undefined ? null : JSON.stringify(observation.ignored),
          observation.relaxed === undefined ? null : JSON.stringify(observation.relaxed),
          // The semantic tier's own list of who moved, kept beside the raster
          // tier's regions rather than folded into them. `null` is a baseline
          // with no hashes; `'[]'` is both sides compared and nothing moved.
          observation.moved === undefined ? null : JSON.stringify(observation.moved),
          keys.before ?? null,
          keys.after ?? null,
          keys.diff ?? null,
          after?.documentDigest ?? null,
          after?.width ?? null,
          after?.height ?? null,
          after === undefined ? null : JSON.stringify(after.missingFonts),
          after?.accessibility === undefined ? null : JSON.stringify(after.accessibility),
          // Null when the push could not read the baseline's header. Not the
          // candidate's numbers: a guess here is a width change made invisible.
          before?.width ?? null,
          before?.height ?? null,
        ),
    );
  }

  for (const variation of report.variations ?? []) {
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO build_variations
             (project, build, subject, parent, identical, bands, unobserved, components,
              digest, how, because)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          project,
          build.build,
          variation.subject,
          variation.parent ?? null,
          // Absent stays absent. `false` would say the pair was compared and
          // differs; what happened is that the parent this run was told about
          // is not in this run, which is a broken link and reads as one.
          variation.identical === undefined ? null : variation.identical ? 1 : 0,
          variation.bands === undefined ? null : JSON.stringify(variation.bands),
          variation.unobserved === undefined ? null : JSON.stringify(variation.unobserved),
          variation.components === undefined ? null : JSON.stringify(variation.components),
          variation.digest ?? null,
          variation.how ?? null,
          variation.because,
        ),
    );
  }

  // The build row is written whenever the run carried a diff, including when
  // the walk refused to attribute it: a refusal with its reason is a fact a
  // reviewer reads, and dropping the row would make it indistinguishable
  // from a run that was never given a ref.
  const reach = report.reach;
  if (reach !== undefined) {
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO build_reach
             (project, build, against_ref, changed, components, whole, unscanned, opaque)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          project,
          build.build,
          reach.against,
          JSON.stringify(reach.changed),
          JSON.stringify(reach.components),
          reach.whole ?? null,
          reach.unscanned === undefined ? null : JSON.stringify(reach.unscanned),
          reach.opaque === undefined ? null : JSON.stringify(reach.opaque),
        ),
    );

    for (const [subject, entry] of Object.entries(reach.subjects ?? {})) {
      statements.push(
        db
          .prepare(
            `INSERT OR REPLACE INTO build_reach_subjects
               (project, build, subject, reached, through, trail, because)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            project,
            build.build,
            subject,
            entry.reached ? 1 : 0,
            entry.through.length === 0 ? null : JSON.stringify(entry.through),
            entry.trail === undefined ? null : JSON.stringify(entry.trail),
            entry.because,
          ),
      );
    }
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
}
