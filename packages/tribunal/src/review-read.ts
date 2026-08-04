import { identityFrom } from '@variance-authority/raster';
import type {
  FindingRecord,
  NotObserved,
  ObservationRecord,
  RegionRecord,
} from '@variance-authority/report';
import type { D1Like } from './bindings.js';
import { ReviewError, number, optionalText, text, type Row } from './review-rows.js';
import type { BuildSummary, Cause, Coverage, DecisionRecord, SubjectView } from './review-types.js';

/**
 * A build, read back out of D1 and turned into what a reviewer is shown.
 *
 * Apart from [`review.ts`](./review.ts) because nothing here writes anything:
 * given rows, these produce the summary, the current decision per subject, the
 * docket and the per-subject view, and every one of them is safe to call twice.
 *
 * Two of the project's arguments are implemented here and nowhere else — that the
 * *current* decision is the highest sequence rather than the newest timestamp,
 * and that the docket is ranked by cause pixels rather than by area — and both
 * are written on the function that carries them, because that is what a later
 * edit will be looking at when it is about to undo one.
 */

export async function summarize(db: D1Like, project: string, row: Row): Promise<BuildSummary> {
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
export async function latestDecisions(
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
export function docket(subjects: readonly SubjectView[]): readonly Cause[] {
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

export function toSubjectView(row: Row, decision: DecisionRecord | null): SubjectView {
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

export function toNotObserved(row: Row): NotObserved {
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
