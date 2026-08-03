import { identityDigest, type Raster, type RenderIdentity } from '@variance-authority/core';
import { RasterStoreError, identityFrom, type RasterStore } from '@variance-authority/raster';
import type {
  FindingRecord,
  NotObserved,
  ObservationRecord,
  RegionRecord,
  RunReport,
} from '@variance-authority/report';
import { base64Of, bytesOf, type D1Like, type R2Like, type TribunalBindings } from './bindings.js';
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
 */

export interface ReviewOptions extends TribunalBindings {
  readonly project: string;
  /** Injected so tests can pin every `at`. Defaults to the wall clock. */
  readonly now?: () => Date;
}

/** One image the run kept, as it arrives. */
export interface CandidateImage {
  /** Base64 PNG — the same encoding a `Raster` carries, for the same reason. */
  readonly bytes: string;
}

/**
 * What a run produced for one subject, over and above the report's record of it.
 *
 * `after` is the candidate and is the only one that can be promoted, which is why
 * it alone carries the sidecar fields. `before` and `diff` exist to be looked at.
 */
export interface SubjectImages {
  readonly after?: CandidateImage & {
    readonly documentDigest: string;
    readonly width: number;
    readonly height: number;
    readonly missingFonts: readonly string[];
  };
  readonly before?: CandidateImage;
  readonly diff?: CandidateImage;
}

export interface BuildIngest {
  /** The operator's own id for the run — a CI job number, a workflow run id. */
  readonly build: string;
  readonly commit: string;
  readonly branch?: string;
  readonly report: RunReport;
  /** Keyed by subject. A subject with no entry is recorded with no images. */
  readonly images?: Readonly<Record<string, SubjectImages>>;
}

export type Decision = 'approved' | 'rejected';

export interface DecisionRecord {
  readonly decision: Decision;
  readonly by: string;
  readonly note?: string;
  readonly at: string;
}

export interface BuildSummary {
  readonly project: string;
  readonly build: string;
  readonly commit: string;
  readonly branch?: string;
  readonly intent?: string;
  readonly at: string;
  readonly identity: RenderIdentity;
  readonly retention: 'durable' | 'ephemeral';
  /** One entry per verdict the report used, including the ones with no subjects. */
  readonly verdicts: Readonly<Record<ObservationRecord['verdict'], number>>;
  readonly decided: number;
  /** Subjects whose verdict needs review and that nobody has decided yet. */
  readonly pending: number;
  readonly coverage: Coverage;
}

/**
 * What the run said about the subjects it did not observe.
 *
 * `stated: false` is the whole reason this is a shape rather than two numbers. A
 * summary that showed `failed: 0` for a report that never carried the list would
 * be asserting coverage on the authority of a writer that declined to claim any.
 */
export interface Coverage {
  readonly stated: boolean;
  readonly failed: number;
  readonly excluded: number;
}

export interface SubjectView {
  readonly subject: string;
  readonly verdict: ObservationRecord['verdict'];
  readonly because: string;
  readonly changedPixels: number;
  readonly regions: readonly RegionRecord[];
  readonly truncated?: { readonly regions: number; readonly pixels: number };
  readonly missingFonts?: readonly string[];
  readonly findings?: readonly FindingRecord[];
  /** Which images this build kept. Absent means the run did not save one. */
  readonly has: { readonly before: boolean; readonly after: boolean; readonly diff: boolean };
  /**
   * The candidate's dimensions, when it kept one.
   *
   * Carried so a viewer can place region rectangles over the image without
   * measuring it in the browser first. Region coordinates are in the raster's own
   * pixel space; a viewer that scaled them by a measured `naturalWidth` would draw
   * the boxes in the right place only after the image had loaded, and in the wrong
   * place for one frame before that.
   */
  readonly size?: { readonly width: number; readonly height: number };
  /** `true` when the candidate carries the sidecar an approval would promote. */
  readonly approvable: boolean;
  readonly decision: DecisionRecord | null;
}

/**
 * A build, and the docket a reviewer reads.
 *
 * `causes` is the ordering the incumbent comparison gets backwards. Ranked by
 * area, a component that only *reflowed* outranks the component that was edited —
 * measured at 6× on one edit — so the docket is grouped by the components the
 * semantic tier named as causes, and collateral is counted rather than listed.
 * One token change across 300 subjects is one review item with a count, never 300
 * lines.
 */
export interface BuildDetail extends BuildSummary {
  readonly subjects: readonly SubjectView[];
  readonly notObserved: readonly NotObserved[];
  readonly causes: readonly Cause[];
}

export interface Cause {
  readonly component: string;
  readonly file?: string;
  readonly subjects: readonly string[];
  readonly pixels: number;
  /** Regions in the same builds that no component claimed as a cause. */
  readonly collateralPixels: number;
}

export interface SweepReport {
  readonly builds: number;
  readonly subjects: number;
  readonly objects: number;
  readonly decisions: number;
}

export interface ReviewStore {
  ingest(build: BuildIngest): Promise<void>;
  builds(limit?: number): Promise<readonly BuildSummary[]>;
  build(id: string): Promise<BuildDetail | null>;
  image(build: string, subject: string, kind: 'before' | 'after' | 'diff'): Promise<ArrayBuffer | null>;
  decide(input: {
    readonly build: string;
    readonly subject: string;
    readonly decision: Decision;
    readonly by: string;
    readonly note?: string;
  }): Promise<DecisionRecord>;
  /** Remove builds older than `keepDays`, and everything that hangs off them. */
  sweep(keepDays: number): Promise<SweepReport>;
}

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
 * A review operation that cannot be carried out, as distinct from a platform
 * that could not be reached.
 *
 * Separate from `RasterStoreError` because they route differently: this is a 4xx
 * — the caller asked for something that is not so — and a store failure is a 5xx
 * and a stopped run. A single error type would make an operator's dashboard show
 * "Cloudflare is down" for a reviewer who clicked approve on the wrong subject.
 */
export class ReviewError extends Error {
  override readonly name = 'ReviewError';
}

interface StoredKeys {
  before?: string;
  after?: string;
  diff?: string;
}

async function store(
  bucket: R2Like,
  project: string,
  build: string,
  subject: string,
  images: SubjectImages | undefined,
): Promise<StoredKeys> {
  if (images === undefined) return {};

  const keys: StoredKeys = {};
  const prefix = `${project}/builds/${encodeURIComponent(build)}/${encodeURIComponent(subject)}`;

  for (const kind of ['before', 'after', 'diff'] as const) {
    const image = images[kind];
    if (image === undefined) continue;
    const key = `${prefix}.${kind}.png`;
    await bucket.put(key, bytesOf(image.bytes));
    keys[kind] = key;
  }
  return keys;
}

/**
 * Approving, as the promotion of an image that already exists.
 *
 * Every field of the baseline comes from what the run uploaded: the bytes from
 * the bucket, the digest and dimensions from the build row, the identity from the
 * build. Nothing is rendered, nothing is measured, and nothing is defaulted — a
 * missing candidate is refused, because the only way to fill the gap would be to
 * paint one, and an approval whose image nobody reviewed is worse than no
 * approval at all.
 */
async function promote(
  bucket: R2Like,
  baselines: RasterStore,
  db: D1Like,
  project: string,
  build: string,
  subject: string,
  row: Row,
): Promise<void> {
  const key = optionalText(row, 'after_key', 'a build subject');
  const digest = optionalText(row, 'candidate_document_digest', 'a build subject');

  if (key === undefined || digest === undefined) {
    throw new ReviewError(
      `subject "${subject}" of build "${build}" cannot be approved: the run did not upload a ` +
        'candidate for it, and a baseline is an image plus the document it was painted from. ' +
        'Approving would mean rendering one now, which is recording rather than promoting',
    );
  }

  const buildRow = await db
    .prepare('SELECT identity FROM builds WHERE project = ? AND build = ?')
    .bind(project, build)
    .first<Row>();
  const identity = identityFrom(JSON.parse(text(buildRow ?? {}, 'identity', 'a build')) as unknown);

  if (identity === null) {
    throw new ReviewError(
      `build "${build}" does not carry a renderer identity that can be read back, so there is no ` +
        'machine to file the promoted baseline under. A baseline with no identity is one every ' +
        'other machine would compare against and none of them should',
    );
  }

  const object = await bucket.get(key);
  if (object === null) {
    throw new RasterStoreError(
      `the candidate image for ${subject} of build "${build}" is recorded at \`${key}\` and the ` +
        'bucket has no such object. The approval is refused rather than promoting a baseline ' +
        'this deployment cannot produce the bytes for',
    );
  }

  const raster: Raster = {
    documentDigest: digest as Raster['documentDigest'],
    identity,
    width: number(row, 'candidate_width', 'a build subject'),
    height: number(row, 'candidate_height', 'a build subject'),
    bytes: base64Of(await object.arrayBuffer()),
    missingFonts: strings(optionalText(row, 'candidate_missing_fonts', 'a build subject')),
  };

  await baselines.put({ subject }, raster);
}

async function summarize(db: D1Like, project: string, row: Row): Promise<BuildSummary> {
  const build = text(row, 'build', 'a build');
  const identity = identityFrom(JSON.parse(text(row, 'identity', 'a build')) as unknown);
  if (identity === null) {
    throw new ReviewError(`build "${build}" carries an identity that is not a renderer identity`);
  }

  const counted = await db
    .prepare(
      'SELECT verdict, COUNT(*) AS n FROM build_subjects WHERE project = ? AND build = ? GROUP BY verdict',
    )
    .bind(project, build)
    .all<Row>();

  const verdicts: Record<ObservationRecord['verdict'], number> = {
    unchanged: 0,
    changed: 0,
    new: 0,
    incomparable: 0,
  };
  for (const entry of counted.results) {
    const verdict = text(entry, 'verdict', 'a verdict count') as ObservationRecord['verdict'];
    if (verdict in verdicts) verdicts[verdict] = number(entry, 'n', 'a verdict count');
  }

  const decisions = await latestDecisions(db, project, build);
  const needing = await db
    .prepare(
      `SELECT subject FROM build_subjects
        WHERE project = ? AND build = ? AND verdict IN ('changed', 'new', 'incomparable')`,
    )
    .bind(project, build)
    .all<Row>();

  const pending = needing.results.filter(
    (subject) => !decisions.has(text(subject, 'subject', 'a build subject')),
  ).length;

  const skipped = await db
    .prepare(
      `SELECT kind, COUNT(*) AS n FROM build_not_observed
        WHERE project = ? AND build = ? GROUP BY kind`,
    )
    .bind(project, build)
    .all<Row>();

  const coverage: Coverage = {
    stated: number(row, 'says_not_observed', 'a build') !== 0,
    failed: countOf(skipped.results, 'failed'),
    excluded: countOf(skipped.results, 'excluded'),
  };

  const branch = optionalText(row, 'branch', 'a build');
  const intent = optionalText(row, 'intent', 'a build');

  return {
    project,
    build,
    commit: text(row, 'commit', 'a build'),
    at: text(row, 'at', 'a build'),
    identity,
    retention: text(row, 'retention', 'a build') === 'ephemeral' ? 'ephemeral' : 'durable',
    verdicts,
    decided: decisions.size,
    pending,
    coverage,
    ...(branch !== undefined ? { branch } : {}),
    ...(intent !== undefined ? { intent } : {}),
  };
}

/**
 * The current decision per subject, from an append-only table.
 *
 * `MAX(seq)` rather than `MAX(at_ms)`: two decisions can share a millisecond, and
 * a tie broken arbitrarily would show a reviewer their earlier answer as the
 * current one. The sequence is the order the rows were written and cannot tie.
 */
async function latestDecisions(
  db: D1Like,
  project: string,
  build: string,
): Promise<ReadonlyMap<string, DecisionRecord>> {
  const rows = await db
    .prepare(
      `SELECT d.subject, d.decision, d.decided_by, d.note, d.at
         FROM decisions d
         JOIN (SELECT subject, MAX(seq) AS seq FROM decisions
                WHERE project = ? AND build = ? GROUP BY subject) latest
           ON latest.seq = d.seq`,
    )
    .bind(project, build)
    .all<Row>();

  const decisions = new Map<string, DecisionRecord>();
  for (const row of rows.results) {
    const note = optionalText(row, 'note', 'a decision');
    decisions.set(text(row, 'subject', 'a decision'), {
      decision: text(row, 'decision', 'a decision') === 'approved' ? 'approved' : 'rejected',
      by: text(row, 'decided_by', 'a decision'),
      at: text(row, 'at', 'a decision'),
      ...(note !== undefined ? { note } : {}),
    });
  }
  return decisions;
}

/**
 * The docket: one entry per cause component, with collateral counted.
 *
 * Ranked by cause pixels rather than by total area, because area measures
 * *displacement* — a container that only reflowed outranks the component that was
 * edited, measured at 6× on one edit. Collateral is summed into the entry rather
 * than listed, so one token change across 300 subjects is one review item with a
 * count.
 */
function docket(subjects: readonly SubjectView[]): readonly Cause[] {
  const causes = new Map<string, { file?: string; subjects: Set<string>; pixels: number }>();
  let collateral = 0;

  for (const subject of subjects) {
    for (const region of subject.regions) {
      if (!region.cause) {
        collateral += region.pixels;
        continue;
      }
      const name = region.component ?? '(unattributed)';
      const entry = causes.get(name) ?? { subjects: new Set<string>(), pixels: 0 };
      entry.pixels += region.pixels;
      entry.subjects.add(subject.subject);
      if (entry.file === undefined && region.file !== undefined) entry.file = region.file;
      causes.set(name, entry);
    }
  }

  return [...causes.entries()]
    .map(([component, entry]) => ({
      component,
      subjects: [...entry.subjects].sort(),
      pixels: entry.pixels,
      // The same total on every entry, and deliberately so: collateral is a
      // property of the build, not of one cause. Splitting it between causes
      // would require deciding which edit pushed which box around, which is
      // exactly the attribution the semantic tier declined to claim.
      collateralPixels: collateral,
      ...(entry.file !== undefined ? { file: entry.file } : {}),
    }))
    .sort((left, right) => right.pixels - left.pixels || left.component.localeCompare(right.component));
}

function toSubjectView(row: Row, decision: DecisionRecord | null): SubjectView {
  const what = 'a build subject';
  const truncated = optionalText(row, 'truncated', what);
  const missingFonts = optionalText(row, 'missing_fonts', what);
  const findings = optionalText(row, 'findings', what);
  const after = optionalText(row, 'after_key', what);
  const width = row['candidate_width'];
  const height = row['candidate_height'];

  return {
    subject: text(row, 'subject', what),
    verdict: text(row, 'verdict', what) as ObservationRecord['verdict'],
    because: text(row, 'because', what),
    changedPixels: number(row, 'changed_pixels', what),
    regions: JSON.parse(text(row, 'regions', what)) as RegionRecord[],
    has: {
      before: optionalText(row, 'before_key', what) !== undefined,
      after: after !== undefined,
      diff: optionalText(row, 'diff_key', what) !== undefined,
    },
    approvable:
      after !== undefined && optionalText(row, 'candidate_document_digest', what) !== undefined,
    decision,
    ...(truncated !== undefined
      ? { truncated: JSON.parse(truncated) as { regions: number; pixels: number } }
      : {}),
    ...(missingFonts !== undefined ? { missingFonts: JSON.parse(missingFonts) as string[] } : {}),
    ...(findings !== undefined ? { findings: JSON.parse(findings) as FindingRecord[] } : {}),
    ...(typeof width === 'number' && typeof height === 'number' ? { size: { width, height } } : {}),
  };
}

function toNotObserved(row: Row): NotObserved {
  const what = 'a not-observed entry';
  return {
    subject: text(row, 'subject', what),
    kind: text(row, 'kind', what) === 'excluded' ? 'excluded' : 'failed',
    because: text(row, 'because', what),
  };
}

function countOf(rows: readonly Row[], kind: string): number {
  const found = rows.find((row) => row['kind'] === kind);
  return found === undefined ? 0 : number(found, 'n', 'a coverage count');
}

function strings(json: string | undefined): readonly string[] {
  if (json === undefined) return [];
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
}

function instant(at: string, what: string): number {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) {
    throw new ReviewError(`${what} carries "${at}", which is not an ISO-8601 instant`);
  }
  return parsed;
}

type Row = Record<string, unknown>;

function text(row: Row, column: string, what: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new ReviewError(`${what} has a \`${column}\` that is not text`);
  }
  return value;
}

function optionalText(row: Row, column: string, what: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ReviewError(`${what} has a \`${column}\` that is neither text nor null`);
  }
  return value;
}

function number(row: Row, column: string, what: string): number {
  const value = row[column];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ReviewError(`${what} has a \`${column}\` that is not a number`);
  }
  return value;
}
