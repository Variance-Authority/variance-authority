import { identityFrom } from '@variance-authority/raster';
import type {
  FindingRecord,
  IgnoreLedger,
  NotObserved,
  ObservationRecord,
  ReachHole,
  ReachedComponent,
  RegionRecord,
  SensitivityLedger,
  SubjectReach,
  VariationRecord,
} from '@variance-authority/report';
import type { D1Like } from './bindings.js';
import { ReviewError, number, optionalText, text, type Row } from './review-rows.js';
import type {
  BuildSummary,
  Cause,
  Coverage,
  Declarations,
  DecisionRecord,
  ReachView,
  SubjectView,
} from './review-types.js';

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

  // Every verdict, including the ones nothing pends on. A map missing a key
  // reports `undefined` where a build genuinely had none, and a review surface
  // that cannot tell "no ignored subjects" from "this build predates ignores" is
  // one an operator has to go to the database to trust.
  const verdicts: Record<ObservationRecord['verdict'], number> = {
    unchanged: 0,
    changed: 0,
    new: 0,
    incomparable: 0,
    ignored: 0,
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
    .sort((left, right) => {
      const byPixels = right.pixels - left.pixels;
      if (byPixels !== 0) return byPixels;
      return left.component < right.component ? -1 : left.component > right.component ? 1 : 0;
    });
}

export function toSubjectView(row: Row, decision: DecisionRecord | null): SubjectView {
  const what = 'a build subject';
  const truncated = optionalText(row, 'truncated', what);
  const missingFonts = optionalText(row, 'missing_fonts', what);
  const findings = optionalText(row, 'findings', what);
  const signals = optionalText(row, 'signals', what);
  const ignored = optionalText(row, 'ignored', what);
  const relaxed = optionalText(row, 'relaxed', what);
  const moved = optionalText(row, 'moved', what);
  const after = optionalText(row, 'after_key', what);
  const width = row['candidate_width'];
  const height = row['candidate_height'];
  const wasWide = row['baseline_width'];
  const wasTall = row['baseline_height'];

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
    ...(signals !== undefined
      ? { signals: JSON.parse(signals) as ObservationRecord['signals'] }
      : {}),
    // Absent stays absent. A row written before step 10, or by a run whose
    // config declared nothing, says nothing here — and a `{}` invented in its
    // place would tell a reader a rule absorbed nothing.
    ...(ignored !== undefined
      ? { ignored: JSON.parse(ignored) as ObservationRecord['ignored'] }
      : {}),
    ...(relaxed !== undefined
      ? { relaxed: JSON.parse(relaxed) as ObservationRecord['relaxed'] }
      : {}),
    ...(moved !== undefined ? { moved: JSON.parse(moved) as ObservationRecord['moved'] } : {}),
    ...(typeof width === 'number' && typeof height === 'number' ? { size: { width, height } } : {}),
    ...(typeof wasWide === 'number' && typeof wasTall === 'number'
      ? { baseline: { width: wasWide, height: wasTall } }
      : {}),
  };
}

/**
 * A stored variation, read back as the record the report wrote.
 *
 * Every optional field stays optional. `identical` is the one worth naming: the
 * column is nullable and `NULL` is read as absent rather than as `false`, because
 * a pair nothing compared and a pair compared and found to differ are different
 * claims, and only the second is something a reviewer can act on.
 *
 * `how` is narrowed rather than cast. A row holding a word this deployment does
 * not know is read as *unstated* — the sentence in `because` still says what
 * happened, and asserting `declared` over an unrecognised value would put "a
 * person said so" on an inference.
 */
export function toVariation(row: Row): VariationRecord {
  const what = 'a build variation';
  const parent = optionalText(row, 'parent', what);
  const identical = row['identical'];
  const bands = optionalText(row, 'bands', what);
  const unobserved = optionalText(row, 'unobserved', what);
  const components = optionalText(row, 'components', what);
  const digest = optionalText(row, 'digest', what);
  const how = optionalText(row, 'how', what);

  return {
    subject: text(row, 'subject', what),
    because: text(row, 'because', what),
    ...(parent !== undefined ? { parent } : {}),
    ...(identical === null || identical === undefined ? {} : { identical: Number(identical) !== 0 }),
    ...(bands !== undefined ? { bands: JSON.parse(bands) as string[] } : {}),
    ...(unobserved !== undefined ? { unobserved: JSON.parse(unobserved) as string[] } : {}),
    ...(components !== undefined ? { components: JSON.parse(components) as string[] } : {}),
    ...(digest !== undefined ? { digest } : {}),
    ...(how === 'declared' || how === 'named' ? { how } : {}),
  };
}

/**
 * The reach rows, read back as the section the page draws.
 *
 * The one rule worth stating: `whole` present means `subjects` stays *absent*,
 * even though the query returned an empty list either way. A refusal rendered as
 * an empty attribution reads as "this commit reaches none of your subjects",
 * which is the sentence somebody merges on — and it is the opposite of what the
 * row says.
 */
export function toReach(row: Row, subjects: readonly Row[]): ReachView {
  const what = 'a build reach';
  const whole = optionalText(row, 'whole', what);
  const unscanned = optionalText(row, 'unscanned', what);
  const opaque = optionalText(row, 'opaque', what);

  const attributed: Record<string, SubjectReach> = {};
  for (const entry of subjects) {
    const because = 'a reached subject';
    const through = optionalText(entry, 'through', because);
    const trail = optionalText(entry, 'trail', because);
    attributed[text(entry, 'subject', because)] = {
      reached: Number(entry['reached']) !== 0,
      through: through === undefined ? [] : (JSON.parse(through) as string[]),
      because: text(entry, 'because', because),
      ...(trail === undefined ? {} : { trail: JSON.parse(trail) as string[] }),
    };
  }

  return {
    against: text(row, 'against_ref', what),
    changed: JSON.parse(text(row, 'changed', what)) as string[],
    components: JSON.parse(text(row, 'components', what)) as ReachedComponent[],
    ...(whole === undefined ? { subjects: attributed } : { whole }),
    ...(unscanned === undefined ? {} : { unscanned: JSON.parse(unscanned) as string[] }),
    ...(opaque === undefined ? {} : { opaque: JSON.parse(opaque) as ReachHole[] }),
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

/**
 * The declaration ledgers, read back whole or read back as absent.
 *
 * No shape checking beyond the parse, and that is the same trade `toReach` makes:
 * the column was written from a typed value by `ingest`, and a reader that
 * re-validated it would be a second opinion about a shape this repository owns.
 * What it does refuse is turning a missing column into an empty ledger.
 */
export function toDeclarations(row: Row): Declarations {
  const ignores = optionalText(row, 'ignores', 'a build');
  const sensitivities = optionalText(row, 'sensitivities', 'a build');
  return {
    ignores: ignores === undefined ? null : (JSON.parse(ignores) as IgnoreLedger),
    sensitivities:
      sensitivities === undefined ? null : (JSON.parse(sensitivities) as SensitivityLedger),
  };
}

function countOf(rows: readonly Row[], kind: string): number {
  const found = rows.find((row) => row['kind'] === kind);
  return found === undefined ? 0 : number(found, 'n', 'a coverage count');
}
