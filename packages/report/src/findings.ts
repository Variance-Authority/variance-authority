/**
 * How a list of defects is labelled, and how it is dated — once, for every surface.
 *
 * Two questions a reader asks of a findings panel, and until this file neither
 * had an answer anywhere:
 *
 * **What kind of report is this?** The rows are rule slugs and clauses —
 * `nested-interactive`, `label-mismatch` — under a heading that says `Findings`
 * or, on the HTML report, nothing at all. A reader who does not already know what
 * the inspector checks has to infer the subject of the report from the names of
 * its rules. The honest label is not one word: nine of the eleven rules band
 * `a11y` and two do not, so a panel headed *Accessibility* would be wrong about
 * the box that overflows its container and the string that was never translated.
 * The band is already on the record and is the axis a project blocks on
 * (`blocking: ['a11y']`), so the heading a reader sees and the policy that stops
 * their merge are the same word by construction.
 *
 * **Is this mine?** A finding is read from one render with no baseline consulted,
 * which is the half a comparison structurally cannot produce — and the cost is
 * that the same list prints on the run that introduced a defect and on the two
 * hundred runs after it. `FindingRecord.standing` carries the answer when a
 * baseline recorded one; the rules for reading it absent are the whole reason
 * this is a shared fold rather than a ternary at each call site. Absent is *not
 * dated*, never *new*: a surface that guessed would announce every inherited
 * defect in a suite as freshly introduced, on the first run after an upgrade, to
 * the person least equipped to check.
 *
 * **Which of them is this reviewer's problem right now?** The two above are
 * readings; this one is an order, and it is the one the surfaces got wrong for
 * longest. A panel that opens on a total and then counts the dates as equal
 * clauses is telling somebody halfway through a button restyle about twenty-two
 * defects they inherited and cannot fix today, before it tells them about the
 * twenty they just caused. [`byArrival`](#byArrival) is the split, and every
 * surface leads with `arrived` and folds the rest behind a count.
 *
 * One fold, many renderers. Five surfaces print these sentences — an HTML report,
 * a review page and three terminal answers — and the part that has to be
 * identical between them is the reading, not the markup.
 */

import type { Band } from '@variance-authority/core/compare';
import type { FindingRecord } from './finding-record.js';

/**
 * What a reader is told the row is about, in the order the bands are reported.
 *
 * Typed against core's `Band` rather than reading core's `BANDS` array, which
 * would be the same list at the cost of a runtime edge from this package into the
 * comparison engine — and this module is bundled into a browser page. The type is
 * the coupling that matters: a band added to core fails to compile here until
 * somebody writes the word a reviewer will read, which is the failure worth
 * having. Insertion order is loudest first, matching `BANDS`, so a mixed list
 * leads with the accessibility defects rather than sorting under `Content`.
 */
const TITLES: Readonly<Record<Band, string>> = {
  a11y: 'Accessibility',
  geometry: 'Layout',
  token: 'Style',
  content: 'Content',
  texture: 'Rendering',
};

/** The reporting order, from the one list that has to name every band anyway. */
const ORDER: readonly string[] = Object.keys(TITLES);

/**
 * The heading for a band, or the one honest heading for a record without one.
 *
 * `Unclassified` rather than a guess. A report written before the band was
 * carried has none, and filing those under `Accessibility` would put the two
 * rules that are not accessibility under a heading that says they are — which is
 * the mislabelling this whole file exists to end, arriving through the default.
 */
export function bandTitle(band: string | undefined): string {
  if (band === undefined) return 'Unclassified';
  return (TITLES as Readonly<Record<string, string>>)[band] ?? band;
}

/** Whether the baseline carried this defect too, as one of three states. */
export type Age = 'standing' | 'new' | 'undated';

/**
 * Which of the three a record is, with absent kept out of the other two.
 *
 * The whole reading is the `undefined` branch. `standing` is only ever set from
 * evidence — the render's document was byte-for-byte the baseline's, or the
 * baseline recorded the marks to cross against — so a record without it is one
 * nothing dated, not one dated *no*. Every surface goes through here rather than
 * writing `finding.standing === true ? … : …`, because that ternary is correct
 * on the two states it names and silently wrong on the third, and it is the
 * third that arrives on the first run after an upgrade.
 */
export function ageOf(finding: FindingRecord): Age {
  if (finding.standing === undefined) return 'undated';
  return finding.standing ? 'standing' : 'new';
}

/** The phrase that goes on the row. Short: it sits beside a component and a file. */
export const AGE_WORDS: Readonly<Record<Age, string>> = {
  new: 'arrived with this change',
  standing: 'already in the baseline',
  undated: 'not dated',
};

/** The same three states at length, for a `title` a reader can hover for the why. */
export const AGE_WHY: Readonly<Record<Age, string>> = {
  new: 'The baseline recorded what was found in it, and this was not among it.',
  standing:
    'The baseline carried this defect too. Approving this change does not approve ' +
    'the defect, and fixing it is separate work.',
  undated:
    'Nothing recorded what the baseline contained — there is no baseline yet, or it ' +
    'was written before findings were kept beside it. This is not a claim that the ' +
    'defect is new.',
};

/** One band's worth of defects, in the order the bands are reported. */
export interface Grouped {
  readonly band: string | undefined;
  readonly title: string;
  readonly findings: readonly FindingRecord[];
}

/**
 * The defects, grouped under the heading each one belongs to.
 *
 * Loudest band first, from core's own order, so the accessibility defects lead a
 * mixed list rather than sorting alphabetically under `Content`. A band nothing
 * in this render fired is not an empty group — it is not a group, because a
 * heading over nothing reads as a category that was checked and found clean, and
 * these rules do not check bands, they check rules.
 */
export function byBand(findings: readonly FindingRecord[]): readonly Grouped[] {
  const groups = new Map<string | undefined, FindingRecord[]>();
  for (const finding of findings) {
    const key = finding.band ?? undefined;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }

  const known = ORDER.filter((band) => groups.has(band)).map(
    (band): Grouped => ({ band, title: bandTitle(band), findings: groups.get(band) ?? [] }),
  );
  const rest = [...groups.entries()]
    .filter(([band]) => band === undefined || !ORDER.includes(band))
    .map(([band, found]): Grouped => ({ band, title: bandTitle(band), findings: found }));

  return [...known, ...rest];
}

/** Two piles and the one fact that says whether the split may be acted on. */
export interface Arrival {
  /** Recorded as absent from the baseline: this change is what put them here. */
  readonly arrived: readonly FindingRecord[];
  /** Everything the record does not put on this change — carried, or never dated. */
  readonly rest: readonly FindingRecord[];
  /** Whether anything in the list carries a date, which is what makes the split a claim. */
  readonly dated: boolean;
}

/**
 * The defects, split by whether the record puts them on this change.
 *
 * The one axis a reviewer mid-change is actually working along, and until this
 * function no surface ordered by it. Every panel led with a total and the method
 * — *42 defects read from this render, with no baseline compared* — and then
 * counted the two dates as equal clauses, which hands somebody reviewing a
 * button restyle twenty-two inherited defects in the same breath as the twenty
 * they just caused. They cannot act on the twenty-two today. Printing them first
 * is how a panel teaches a reviewer to stop reading it.
 *
 * Two piles, and `undated` is in neither by name. It goes with the rest because
 * the rest is defined by what it is *not* — not recorded as arriving with this
 * change — which is exactly true of a finding nothing dated, and stays true when
 * the record improves. Calling that pile *inherited* would be the guess this
 * whole axis exists to refuse.
 *
 * {@link Arrival.dated} is what decides whether a surface may fold at all. When
 * nothing carries a date, `arrived` is empty and `rest` is the whole list, and a
 * renderer that folded on that would hide every defect in the render behind a
 * summary — on exactly the run where there is no baseline to have inherited them
 * from.
 */
export function byArrival(findings: readonly FindingRecord[]): Arrival {
  return {
    arrived: findings.filter((finding) => ageOf(finding) === 'new'),
    rest: findings.filter((finding) => ageOf(finding) !== 'new'),
    dated: findings.some((finding) => ageOf(finding) !== 'undated'),
  };
}

/**
 * The sentence that goes first, which is about this change and nothing else.
 *
 * Three answers, and the third is not a count. A run with no dating on it cannot
 * say *nothing arrived* — that is a claim about a baseline nobody read — so it
 * says what it does know, which is that the question has no answer here.
 */
export function arrivalLine(findings: readonly FindingRecord[]): string {
  const { arrived, dated } = byArrival(findings);

  if (arrived.length > 0) return `${plural(arrived.length, 'defect')} arrived with this change`;
  if (dated) return 'Nothing here arrived with this change';
  return 'Nothing recorded what the baseline held, so none of them can be dated to this change';
}

/**
 * The rest, counted once, for the summary a surface folds them behind.
 *
 * `undefined` when there is nothing to fold — either the list is all arrivals, or
 * nothing is dated and the split would be an invention. The two states are
 * counted apart even here: *already in the baseline* is a fact about a record
 * somebody wrote, and *the baseline does not account for* is the absence of one,
 * and a reviewer deciding whether to open the fold is entitled to know which.
 */
export function carriedLine(findings: readonly FindingRecord[]): string | undefined {
  const { rest, dated } = byArrival(findings);
  if (!dated || rest.length === 0) return undefined;

  const held = rest.filter((finding) => ageOf(finding) === 'standing').length;
  const undated = rest.length - held;

  return [
    held === 0 ? undefined : `${String(held)} already in the baseline`,
    undated === 0 ? undefined : `${String(undated)} the baseline does not account for`,
  ]
    .filter((clause): clause is string => clause !== undefined)
    .join(', ');
}

/** Why nothing in the list moved the verdict. Method, so it goes last. */
export function methodLine(findings: readonly FindingRecord[]): string {
  return `${plural(findings.length, 'defect')} read from this render, with no baseline compared`;
}

/**
 * Whether the rows in one list disagree about their date.
 *
 * The gate on drawing a date per row, and it is per *list* rather than per
 * report. A column of rows all saying `arrived with this change`, under a heading
 * that already says it, is a word a reader stops seeing — and once a surface
 * splits arrivals from the rest, every list it draws is uniform unless the fold
 * happens to hold both a dated and an undated row. That case is the only one
 * where the row is carrying the finding rather than repeating the heading.
 */
export function mixedAges(findings: readonly FindingRecord[]): boolean {
  return new Set(findings.map(ageOf)).size > 1;
}

/**
 * The whole opening, for a surface with one line to spend rather than a panel.
 *
 * Same three parts in the same order the panels draw them: what arrived, what was
 * already here, and last the method — which is the sentence that explains why
 * none of this moved the verdict, and which used to be first because it explains
 * the list rather than because anybody needed it before the count.
 */
export function findingTotals(findings: readonly FindingRecord[]): string {
  if (findings.length === 0) return methodLine(findings);

  return [arrivalLine(findings), carriedLine(findings), methodLine(findings)]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
