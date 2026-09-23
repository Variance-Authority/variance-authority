import type {
  FindingRecord,
  IgnoreLedger,
  JourneyParting,
  JourneysReport,
  NotObserved,
  ObservationRecord,
  ReachedComponent,
  RegionRecord,
  SensitivityLedger,
  SubjectReach,
  VariationRecord,
} from '@variance-authority/report';
import {
  ReviewError,
  number,
  optionalNumber,
  optionalText,
  text,
  type Row,
} from './review-rows.js';
import type {
  Cause,
  Declarations,
  DecisionRecord,
  MovementView,
  Placement,
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
  };
}

/**
 * One census row, read back as an edge a sentence can be built from.
 *
 * No shape checking beyond the parse, for the reason `toReach` gives: the
 * columns were written from a typed value by `ingest`.
 */
export function toPlacement(row: Row): Placement {
  const what = 'a composition entry';
  return {
    component: text(row, 'component', what),
    subjects: JSON.parse(text(row, 'subjects', what)) as string[],
    within: JSON.parse(text(row, 'within', what)) as string[],
    createdBy: JSON.parse(text(row, 'created_by', what)) as string[],
    renders: JSON.parse(text(row, 'renders', what)) as string[],
  };
}

/**
 * One attributed movement, read back as the run wrote it.
 *
 * `cause` is narrowed by comparison against the five rungs rather than cast. It
 * is the only column here a later schema could widen, and a row carrying a rung
 * this build does not know is a row it must refuse rather than print.
 */
export function toMovement(row: Row): MovementView {
  const what = 'a movement';
  const cause = text(row, 'cause', what);
  if (!RUNGS.includes(cause as MovementView['cause'])) {
    throw new ReviewError(`${what} carries a cause this build does not know: "${cause}"`);
  }

  const file = optionalText(row, 'file', what);
  const tokens = optionalText(row, 'tokens', what);
  const upstream = optionalText(row, 'upstream', what);
  const through = optionalText(row, 'through', what);
  const standing = optionalText(row, 'standing', what);
  const compared = optionalNumber(row, 'compared', what);

  return {
    subject: text(row, 'subject', what),
    component: text(row, 'component', what),
    cause: cause as MovementView['cause'],
    because: text(row, 'because', what),
    bands: JSON.parse(text(row, 'bands', what)) as string[],
    held: JSON.parse(text(row, 'held', what)) as string[],
    ...(compared === undefined ? {} : { compared }),
    ...(file === undefined ? {} : { file }),
    ...(tokens === undefined ? {} : { tokens: JSON.parse(tokens) as string[] }),
    ...(upstream === undefined ? {} : { upstream }),
    ...(through === undefined ? {} : { through: JSON.parse(through) as string[] }),
    ...(standing === undefined ? {} : { standing: standing === 'flake' ? 'flake' : 'suspect' }),
  };
}

const RUNGS: readonly MovementView['cause'][] = [
  'edited',
  'token',
  'upstream',
  'contradicted',
  'unexplained',
];

// Named, not defaulted-to-`failed`. The stored word is the run's conclusion, and
// anything the reader does not recognise is a hole in this reader — which is
// what `failed` says — rather than in the run.
const NOT_OBSERVED: readonly NotObserved['kind'][] = ['excluded', 'unreached', 'failed'];

export function toNotObserved(row: Row): NotObserved {
  const what = 'a not-observed entry';
  const kind = text(row, 'kind', what);
  return {
    subject: text(row, 'subject', what),
    kind: NOT_OBSERVED.find((known) => known === kind) ?? 'failed',
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

/**
 * The journeys row, read back as the section the run wrote.
 *
 * Parsed and not checked, for the reason `toReach` gives: the row is the
 * report's own JSON, written by this service from a shape the report package
 * owns.
 */
export function toJourneys(row: Row): JourneysReport {
  const what = 'a build journeys';
  const commit = row['journal_commit'];
  return {
    ...(typeof commit === 'string' ? { commit } : {}),
    whole: JSON.parse(text(row, 'whole', what)) as string[],
    truncated: JSON.parse(text(row, 'truncated', what)) as string[],
    unrecorded: JSON.parse(text(row, 'unrecorded', what)) as string[],
    found: JSON.parse(text(row, 'found', what)) as JourneyParting[],
  };
}
