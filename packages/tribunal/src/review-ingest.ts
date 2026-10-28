import {
  identityDigest,
  keepsSnapshot,
  PACKED_SNAPSHOT_HEADER,
  type RenderIdentity,
} from '@variance-authority/core/format';
import type { D1Like, D1PreparedLike, R2Like } from './bindings.js';
import { ReviewError, instant } from './review-rows.js';
import type { BuildIngest, SubjectImages } from './review-ingest-types.js';
import { promotedIdentity, store } from './review-write.js';

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
  // The moment these bytes were stored, for the object ledger — the build's own
  // timestamp rather than the wall clock, so an object's idle window is measured
  // on the same clock as the build that referred to it.
  const atMs = instant(at, `build "${build.build}"`);

  // Objects first, rows second — the same order and the same argument as the
  // baseline store's `put`. An object nothing points at is invisible and is
  // swept; a row pointing at nothing is a build that throws whenever anybody
  // opens it.
  //
  // The whole build's images in one call rather than a call per subject, which
  // is not a detail of style: a Worker spends a subrequest on every binding
  // call, and doing this per image cost a 300-subject run some two thousand of
  // them against a ceiling of ten thousand. `store` asks once what is already
  // here, writes what is not, and claims all of it in one batch.
  const written = await store(db, bucket, project, build.build, images, atMs);

  // The build's own rows, cleared before they are rewritten.
  //
  // Every table below is written with `INSERT OR REPLACE`, which replaces a row
  // whose key comes back and leaves one that does not. A second ingest of the
  // same build is not a rarity — it is what happens every time a run is
  // re-pushed after the tool that produced it was fixed — and under replace
  // alone the reading that was wrong survives beside the reading that replaced
  // it, for every subject, component or pair the new report no longer names. A
  // reviewer then reads an attribution from a version of the analysis that no
  // longer exists, with nothing on the page to say so.
  //
  // Same `batch` as the inserts, so there is no instant where the build is on
  // the page with its rows gone. `builds` is one row per build and is not
  // cleared: `INSERT OR REPLACE` on a single known key is already exact.
  // `decisions` is nobody's to clear here — a person put their name on those,
  // and re-pushing a run is not them taking it back.
  const statements = [
    ...[
      'build_subjects',
      'build_not_observed',
      'build_variations',
      'build_composition',
      'build_movements',
      'build_reach_subjects',
      'build_reach',
    ].map((table) =>
      db.prepare(`DELETE FROM ${table} WHERE project = ? AND build = ?`).bind(project, build.build),
    ),
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
        atMs,
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

  for (const observation of report.observations) {
    const keys = written.get(observation.subject) ?? {};
    const after = images[observation.subject]?.after;
    const before = images[observation.subject]?.before;
    const candidateIdentity = after?.identity === undefined ? null : JSON.stringify(after.identity);
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO build_subjects
             (project, build, subject, verdict, because, changed_pixels, regions, truncated,
              missing_fonts, findings, signals, ignored, relaxed, moved, before_key, after_key,
              diff_key, candidate_document_digest, candidate_width, candidate_height,
              candidate_missing_fonts, candidate_accessibility,
              candidate_identity, candidate_components, candidate_finding_marks,
              candidate_snapshot, baseline_width, baseline_height)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          // The identity the document was painted under, which the build row
          // does not hold: its identity describes the machine and leaves the
          // scale at 1. Null is a push from a CLI that predates the field, and
          // `promote` falls back to the build's there.
          candidateIdentity,
          // `null` is *not recorded*; `'[]'` is *read, and empty*. A promotion
          // that turned the first into the second would tell every later run
          // this document declared no components and this render was clean.
          after?.components === undefined ? null : JSON.stringify(after.components),
          after?.findingMarks === undefined ? null : JSON.stringify(after.findingMarks),
          after?.snapshot ?? null,
          // Null when the push could not read the baseline's header. Not the
          // candidate's numbers: a guess here is a width change made invisible.
          before?.width ?? null,
          before?.height ?? null,
        ),
    );
    // Filed under the identity an approval would file it under, read off the
    // same column value.
    const under = promotedIdentity({ candidate_identity: candidateIdentity }, identity);
    const recorded = recordSnapshot(db, project, observation.subject, after, under);
    if (recorded !== null) statements.push(recorded);
  }

  for (const variation of report.variations ?? []) {
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO build_variations
             (project, build, subject, parent, identical, bands, unobserved, components,
              digest, how, step, because)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          variation.step === undefined ? null : JSON.stringify(variation.step),
          variation.because,
        ),
    );
  }

  // One row, the section as written. Absent writes nothing, so a reader finding
  // no row knows the build carried no journal rather than no partings — `found`
  // empty is the row saying the second.
  const journeys = report.journeys;
  if (journeys !== undefined) {
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO build_journeys
             (project, build, journal_commit, whole, truncated, unrecorded, found)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          project,
          build.build,
          journeys.commit ?? null,
          JSON.stringify(journeys.whole),
          JSON.stringify(journeys.truncated),
          JSON.stringify(journeys.unrecorded),
          JSON.stringify(journeys.found),
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
             (project, build, against_ref, changed, components, whole, unscanned)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          project,
          build.build,
          reach.against,
          JSON.stringify(reach.changed),
          JSON.stringify(reach.components),
          reach.whole ?? null,
          reach.unscanned === undefined ? null : JSON.stringify(reach.unscanned),
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

  // The census, which is the only record in a report that answers *what draws
  // this*. `reach` answers the mirror question and cannot answer this one: it
  // walks importers, so a component a changed file renders is off its graph in
  // the one direction it never goes.
  //
  // Narrowed to four columns of the report's own `ComponentRecord`. The rest —
  // instance counts, variant counts, the token list — is a census a reader opens
  // the report for; what a review page needs is the edges.
  for (const entry of report.composition?.components ?? []) {
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO build_composition
             (project, build, component, subjects, within, created_by, renders)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          project,
          build.build,
          entry.component,
          JSON.stringify(entry.subjects),
          JSON.stringify(entry.within),
          JSON.stringify(entry.createdBy),
          JSON.stringify(entry.renders),
        ),
    );
  }

  // The attribution, which is the part of the census a reviewer actually reads.
  // The rows above say `Card` draws `CardFooter`; these say the run climbed that
  // edge, found `ProductCard` in the diff, and concluded `CardFooter` moved on
  // what it was handed. Dropping them left the page to re-derive a worse answer
  // from the graph alone — without the props digests, the control group or the
  // source index the run had used — and to print *nothing declares this* about
  // components the run had already attributed to an edited parent.
  for (const entry of report.composition?.movements ?? []) {
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO build_movements
             (project, build, subject, component, cause, because, bands, held,
              compared, file, tokens, upstream, through, standing)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          project,
          build.build,
          entry.subject,
          entry.component,
          entry.cause,
          entry.because,
          JSON.stringify(entry.bands),
          JSON.stringify(entry.held),
          entry.compared ?? null,
          entry.file ?? null,
          entry.tokens === undefined ? null : JSON.stringify(entry.tokens),
          entry.upstream ?? null,
          entry.through === undefined ? null : JSON.stringify(entry.through),
          entry.standing ?? null,
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
}

/**
 * The snapshot of an unchanged subject, onto the baseline that kept none.
 *
 * Approval is asked of a changed subject, so nothing a reviewer does records
 * this one, and `settle` renders a baseline that kept no snapshot on every run,
 * for somebody to record one. Recorded here instead, on the premise `settle`
 * skips a render on: a document that digests to what the baseline was painted
 * from, under the identity it was painted under, paints that image. What the
 * tree read off the page is that image's; what it read off the runtime that
 * drew it, authors and the state they held, is the recording push's: the first,
 * from a build on any branch, that drew the same document onto a baseline that
 * kept none, as it is the accepting run's on a baseline `variance accept`
 * re-stamps. Whatever verdict the run reported: the premise is the document.
 *
 * The row is the one an approval would overwrite, and only when it has an
 * image, as `settle` asks. A snapshot it kept is never replaced, and text this
 * code cannot read is never recorded. The image, the digest and the time the
 * baseline was written stay as they were: nothing about the picture moved.
 */
function recordSnapshot(
  db: D1Like,
  project: string,
  subject: string,
  after: SubjectImages['after'],
  under: RenderIdentity,
): D1PreparedLike | null {
  if (after?.documentDigest === undefined || !keepsSnapshot(after.snapshot)) return null;
  return db
    .prepare(
      `UPDATE baselines SET snapshot = ?
        WHERE project = ? AND identity_digest = ? AND subject = ? AND label = ''
          AND document_digest = ? AND object_key IS NOT NULL
          AND (snapshot IS NULL OR substr(snapshot, 1, ?) <> ?)`,
    )
    .bind(
      after.snapshot!,
      project,
      identityDigest(under),
      subject,
      after.documentDigest,
      PACKED_SNAPSHOT_HEADER.length,
      PACKED_SNAPSHOT_HEADER,
    );
}
