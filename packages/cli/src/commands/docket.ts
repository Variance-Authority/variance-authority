import type { ObservationRecord, RegionRecord } from '@variance-authority/report';
import type { CliRunReport, NotObserved } from './run.js';

/**
 * The docket: a run report folded into the review items a person can act on.
 *
 * Separate from the rendering because it is the half that carries the argument.
 * Every type here exists to keep two claims apart that a comment would otherwise
 * merge — *this is the edit* against *this is the largest thing that moved*, and
 * *nothing changed* against *nothing was looked at* — and the shapes below are
 * what make the renderer unable to state one in the voice of the other.
 *
 * Nothing here produces a character of output. That is what lets the fold be
 * tested by asserting on counts rather than by matching prose, and what lets the
 * prose change without any of these decisions moving.
 */

/**
 * One review item: a cause, everywhere it is the cause.
 *
 * Keyed by component rather than by subject, which is the entire point. The same
 * `Button` edit seen in 300 stories is one of these with `subjects.length === 300`,
 * and a reviewer reads one line instead of scrolling past 299 restatements of it.
 */
export interface CauseEntry {
  /** Plain text. A renderer escapes it for its own medium; the fold never does. */
  readonly label: string;
  /**
   * `true` when the label is a component name rather than a sentence about why
   * there is none. Decides code voice, which no renderer can infer from the text.
   */
  readonly named: boolean;
  readonly files: readonly string[];
  readonly wheres: readonly string[];
  readonly subjects: readonly string[];
  /**
   * Subjects in which the semantic tier actually named this a cause.
   *
   * Below `subjects.length` when some of those entries were picked by area
   * instead, and `0` when none were. Kept as a count rather than a flag because
   * the two are different claims — "this is the edit" and "this is the largest
   * thing that moved" — and printing the second in the voice of the first is
   * exactly the confident wrong attribution this repository refuses elsewhere.
   */
  readonly namedIn: number;
  readonly pixels: number;
}

/** Everything that moved without being the thing that was edited. Counted, never listed. */
export interface Collateral {
  readonly regions: number;
  readonly pixels: number;
  readonly components: number;
  readonly subjects: number;
  /** Regions the run itself found and chose not to record, from `truncated`. */
  readonly unrecorded: number;
  readonly unrecordedPixels: number;
}

/** Subjects with a verdict but no region to point at, grouped by the reason. */
export interface Group {
  readonly verdict: ObservationRecord['verdict'];
  readonly because: string;
  readonly subjects: readonly string[];
}

export interface Docket {
  readonly causes: readonly CauseEntry[];
  readonly collateral: Collateral;
  readonly withoutCause: readonly Group[];
  /**
   * Observations a person has to decide about.
   *
   * Both green verdicts are excluded, not one. `ignored` means pixels moved and
   * every one of them fell inside something the operator already excluded — the
   * decision was made when the rule was written, and `exitFor`, `variance_summary`
   * and the review backend all treat it as green. A docket that counted it would
   * put a number in the pull-request comment that the exit code contradicts.
   */
  readonly reviewable: number;
  readonly failed: readonly NotObserved[];
  readonly excluded: number;
  /**
   * Subjects this change provably cannot reach.
   *
   * Counted apart from `excluded` because it is the opposite kind of fact. An
   * exclusion is a standing decision that survives the commit; this is a
   * conclusion about *this* diff, and next week's diff reaches them again.
   */
  readonly unreached: number;
  /** Font family → how many subjects were rendered without it. */
  readonly missingFonts: ReadonlyMap<string, number>;
}

interface CauseAccumulator {
  label: string;
  named: boolean;
  readonly files: Set<string>;
  readonly wheres: Set<string>;
  readonly subjects: string[];
  namedIn: number;
  pixels: number;
}

/**
 * Fold a run report into a docket: one entry per cause, everything else counted.
 *
 * The lead region is `the first region marked cause, else the first region at
 * all`, and the fallback is the load-bearing half. `rankRegions` sorts causes
 * first and area second, so when the semantic tier named nothing — a profile
 * without provenance, a change with no traceable root — every region comes back
 * `cause: false` and the subject would have no entry at all. Dropping it would be
 * a changed subject that appears in no list, which is the one outcome forbidden
 * everywhere else in this system. So it gets an entry built from its largest
 * region, and {@link CauseEntry.namedIn} records that nothing named it, so the
 * rendering can say "largest region" rather than "the cause".
 */
export function docketOf(report: CliRunReport): Docket {
  const causes = new Map<string, CauseAccumulator>();
  const groups = new Map<string, { verdict: ObservationRecord['verdict']; because: string; subjects: string[] }>();
  const missingFonts = new Map<string, number>();
  const collateralComponents = new Set<string>();
  const collateralSubjects = new Set<string>();

  let reviewable = 0;
  let collateralRegions = 0;
  let collateralPixels = 0;
  let unrecorded = 0;
  let unrecordedPixels = 0;

  for (const observation of report.observations) {
    for (const font of observation.missingFonts ?? []) {
      missingFonts.set(font, (missingFonts.get(font) ?? 0) + 1);
    }

    if (observation.verdict === 'unchanged' || observation.verdict === 'ignored') continue;
    reviewable += 1;

    const lead = observation.regions.find((region) => region.cause) ?? observation.regions[0];

    if (lead === undefined) {
      // `new`, `incomparable`, and anything the cheap tiers settled: a verdict
      // with no geometry behind it. Grouped by the reason rather than listed one
      // per subject, because 300 subjects with no baseline share one sentence and
      // repeating it 300 times says nothing the count does not.
      const key = `${observation.verdict}\u0000${observation.because}`;
      const group = groups.get(key) ?? {
        verdict: observation.verdict,
        because: observation.because,
        subjects: [],
      };
      group.subjects.push(observation.subject);
      groups.set(key, group);
      continue;
    }

    const key = keyOf(lead);
    const entry = causes.get(key) ?? {
      ...labelOf(lead),
      files: new Set<string>(),
      wheres: new Set<string>(),
      subjects: [],
      namedIn: 0,
      pixels: 0,
    };

    entry.subjects.push(observation.subject);
    entry.pixels += lead.pixels;
    if (lead.cause) entry.namedIn += 1;
    if (lead.file !== undefined) entry.files.add(lead.file);
    if (lead.where !== undefined) entry.wheres.add(lead.where);
    causes.set(key, entry);

    for (const region of observation.regions) {
      if (region === lead) continue;
      collateralRegions += 1;
      collateralPixels += region.pixels;
      // Components, not keys. `keyOf` falls back to a path so that regions group
      // at all, and counting those made "in 1 component(s)" appear over a page
      // that has none.
      if (region.component !== undefined) collateralComponents.add(region.component);
      collateralSubjects.add(observation.subject);
    }

    if (observation.truncated !== undefined) {
      unrecorded += observation.truncated.regions;
      unrecordedPixels += observation.truncated.pixels;
    }
  }

  const entries = [...causes.values()]
    .map((entry) => ({
      label: entry.label,
      named: entry.named,
      files: [...entry.files],
      wheres: [...entry.wheres],
      subjects: entry.subjects,
      namedIn: entry.namedIn,
      pixels: entry.pixels,
    }))
    // Named causes first, then reach, then pixels. Reach before pixels because
    // the question a reviewer is answering is "how much of the product does this
    // touch", and one enormous region in one story is a smaller decision than a
    // small region in two hundred.
    .sort(
      (a, b) =>
        Number(b.namedIn > 0) - Number(a.namedIn > 0) ||
        b.subjects.length - a.subjects.length ||
        b.pixels - a.pixels,
    );

  const notObserved = report.notObserved ?? [];

  return {
    causes: entries,
    collateral: {
      regions: collateralRegions,
      pixels: collateralPixels,
      components: collateralComponents.size,
      subjects: collateralSubjects.size,
      unrecorded,
      unrecordedPixels,
    },
    withoutCause: [...groups.values()],
    reviewable,
    failed: notObserved.filter((entry) => entry.kind === 'failed'),
    excluded: notObserved.filter((entry) => entry.kind === 'excluded').length,
    unreached: notObserved.filter((entry) => entry.kind === 'unreached').length,
    missingFonts,
  };
}

/**
 * The key two regions must share to be one review item.
 *
 * `component` first, because that is the thing a person edits. `path` is the
 * fallback for a tree with no provenance — an address rather than a name, but a
 * stable one. Unattributed regions collapse to a single key on purpose: three
 * hundred regions no box contained is one finding ("the scale or the origin is
 * wrong"), not three hundred.
 */
function keyOf(region: RegionRecord): string {
  if (region.unattributed === true) return '\u0000unattributed';
  return region.component ?? region.path ?? '\u0000unknown';
}

/**
 * The label as **plain text**, and a flag for whether it is a name or a sentence.
 *
 * It used to arrive markdown-escaped, which read as a small convenience and was
 * a renderer decision taken inside the fold. The cost surfaced the moment a third
 * rendering existed: an HTML page received a component name wrapped in backticks
 * and would have had to *undo* another renderer's formatting to show it — two
 * renderers disagreeing about one docket, which is the whole thing this file is
 * separate in order to prevent.
 *
 * So the fold decides what the label *is* and each rendering decides how to show
 * it. `named` is the distinction a renderer cannot recover from the string:
 * `Button` is a thing somebody can grep for and belongs in code voice, while
 * "region outside every box" is a sentence and does not.
 */
function labelOf(region: RegionRecord): { label: string; named: boolean } {
  if (region.unattributed === true) {
    return {
      label: 'region outside every box (check scale or origin)',
      named: false,
    };
  }

  if (region.component !== undefined) return { label: region.component, named: true };

  // No component, so no name — and `path` is not one. A tree without provenance
  // is every page this project did not write in React, and labelling its lead
  // region `0/1` published a pull-request comment whose first cause was a child
  // index in code voice. `named: true` then told the renderer it was greppable,
  // which is how "**`0/1`** — largest changed region" reached a reviewer with
  // nothing in it to open, search for, or edit.
  //
  // The landmark phrase is the intended answer and `locate` builds it from roles
  // and names; a page with neither leaves it empty, and then the honest label is
  // the geometry, which at least finds the thing in the diff image. `keyOf` goes
  // on grouping by `path` — an address is a poor name and a perfectly good key.
  if (region.where !== undefined && region.where !== '') {
    return { label: `a region in ${region.where}`, named: false };
  }

  return {
    label: `a region at ${region.x},${region.y} (${region.width}×${region.height})`,
    named: false,
  };
}
