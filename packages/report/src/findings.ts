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
 * One fold, many renderers. Four surfaces print these sentences — an HTML report,
 * a review page and two terminal answers — and the part that has to be identical
 * between them is the reading, not the markup.
 */

import type { Band } from '@variance-authority/core';
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

/**
 * How many of them are whose, as clauses — nothing about where they came from.
 *
 * Separate from {@link findingTotals} because the opening sentence is the one
 * part of this that is surface-specific: a panel over one render says *read from
 * this render*, and a tool answering across a whole report cannot. The dating is
 * the half that has to read identically everywhere, so it is the half that is
 * shared, and a surface that writes its own opening still cannot write its own
 * arithmetic.
 *
 * Empty when there is nothing to count. The all-undated case is a clause rather
 * than an omission: a list with no dating on it looks exactly like a list of
 * standing defects, and the difference is the whole question.
 */
export function datingOf(findings: readonly FindingRecord[]): readonly string[] {
  if (findings.length === 0) return [];

  const parts: string[] = [];
  const fresh = findings.filter((finding) => ageOf(finding) === 'new').length;
  const held = findings.filter((finding) => ageOf(finding) === 'standing').length;
  const undated = findings.length - fresh - held;

  if (fresh > 0) parts.push(`${String(fresh)} arrived with this change`);
  if (held > 0) parts.push(`${String(held)} already in the baseline`);
  if (undated === findings.length) {
    parts.push('nothing recorded what the baseline contained, so none of them can be dated');
  } else if (undated > 0) {
    parts.push(`${String(undated)} the baseline does not account for`);
  }

  return parts;
}

/**
 * Whether any of them carry a date, which decides whether to print one per row.
 *
 * A row that says *not dated* on a report where nothing is dated has spent a
 * line to repeat what {@link datingOf} already said once. A row that says it on a
 * report where its neighbours are dated is carrying the finding.
 */
export function anyDated(findings: readonly FindingRecord[]): boolean {
  return findings.some((finding) => ageOf(finding) !== 'undated');
}

/**
 * What the panel says above the list.
 *
 * Leads with the method, because it is the sentence that explains why the list
 * exists at all and why nothing in it moved the verdict: these were read from
 * this render, and no baseline was consulted to find them. Then the dating, which
 * is the part a reviewer acts on — and which says *when it arrived is not
 * recorded* out loud rather than printing a count that quietly means zero.
 */
export function findingTotals(findings: readonly FindingRecord[]): string {
  return [
    `${plural(findings.length, 'defect')} read from this render, with no baseline compared`,
    ...datingOf(findings),
  ].join(' · ');
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
