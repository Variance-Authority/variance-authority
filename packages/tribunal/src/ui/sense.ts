/**
 * What moved, in the sense the digests recorded rather than the area it covered.
 *
 * The page this exists for used to read *2 distinct differences, in 7 renders.
 * 30,373 px in total* — three numbers, none of which is the change. A reviewer
 * cannot approve what they have not been told, and every one of those figures
 * describes the measurement instead of the edit.
 *
 * The run always knew better. A baseline carries a component's hashes split five
 * ways, so a comparison of two sidecars can say *this component's declared style
 * moved and its layout moved and its text did not* — without decoding a pixel,
 * and without depending on the difference having landed somewhere a box could be
 * drawn around. The report carries that list per subject; this turns it into the
 * two things a surface needs from it.
 *
 * ## The two things
 *
 * **What each component moved in**, which is the sentence the page was missing.
 *
 * **What the picture lost**, which is the finding nobody was being shown. A
 * region is named by resolving the box the pixels drew back to a component, so
 * it fails precisely when a change matters most: an edit that reflows its
 * neighbours merges into one blob, the blob fits no component, and the name that
 * comes back is the document root. Held against the hashes, that subject stops
 * being a mystery — `Button` moved in its layout and its declared style, and no
 * region carries the name. The gap is reportable, and until it is reported the
 * page is quietly confident about a component it never mentioned.
 *
 * The reverse pile is kept too, and it is not the same finding. A component a
 * region names while its own hashes held still was *pushed* — it is collateral,
 * and a page that called it a change would be doing the ranking this project
 * exists to correct.
 */

import type { SubjectView } from '../review-types.js';
import type { Appearance } from './grouping.js';
import { causeOf } from './lead.js';

/** One component the hashes say moved, held against what the picture found. */
export interface Sensed {
  readonly component: string;
  readonly bands: readonly string[];
  /** Its own content moved, rather than only its rect being pushed. */
  readonly cause: boolean;
  /** Present on one side only, which `bands` alone cannot say. */
  readonly presence?: 'added' | 'removed';
  /** A region in this subject resolved to this name. */
  readonly drawn: boolean;
}

/** A subject read at the semantic tier, and the two tiers held against each other. */
export interface Sense {
  /**
   * `false` when the baseline carried no hashes, so none of this was measured.
   *
   * The whole record collapses to *unknown* rather than to *nothing moved*, and
   * a surface must print the difference. An empty `moved` on a measured subject
   * with pixels in it is a real finding; the same emptiness unmeasured is a
   * baseline written before the hashes existed.
   */
  readonly measured: boolean;
  readonly moved: readonly Sensed[];
  /** Caused the difference, and no region names it: what the picture lost. */
  readonly missed: readonly Sensed[];
  /** Named by a region while its own hashes held still — pushed, not edited. */
  readonly pushed: readonly string[];
}

/**
 * The band, in the words a reviewer thinks in.
 *
 * Not the band name. `token` is a word this project uses precisely and a reader
 * arriving from a pull request does not, and a page that leads with it has spent
 * its most important line on vocabulary. The mapping is deliberately flat — one
 * phrase each, no qualifiers — because these are joined into a clause and a
 * hedge repeated four times down a list is a hedge nobody reads.
 *
 * An unknown band is returned unchanged. A newer report carrying a band this
 * deployment has never heard of should print the word it was given, not vanish.
 */
export function senseOf(band: string): string {
  return SENSES[band] ?? band;
}

const SENSES: Readonly<Record<string, string>> = {
  // Role, accessible name, ARIA state: what a screen reader says out loud.
  a11y: 'what it announces',
  // Both the structure digest and the rect: tags, attributes, child boundaries,
  // and where the boxes ended up. One phrase, because a reviewer asking "did the
  // layout move" is not distinguishing the two and the digests cannot either.
  geometry: 'its layout',
  token: 'its style values',
  content: 'its text',
  // Never produced by a hash comparison — a component hash is built from a
  // document. Here so a report that grows one is not printed as a bare slug.
  texture: 'its texture',
};

/** `its layout and its style values` — the bands as one clause, loudest first. */
export function senses(bands: readonly string[]): string {
  const words = bands.map(senseOf);
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}

/**
 * One subject, with the hashes and the regions read against each other.
 *
 * The join is on the component name and nothing else, which is the only key the
 * two tiers share: a region carries the name its box resolved to, and a hash
 * entry carries the name the boundary walk assigned. Both come from the same
 * walk in the same run, so a name that appears in one and not the other is a
 * real disagreement rather than a spelling.
 */
export function senseOfSubject(subject: SubjectView): Sense {
  const drawn = new Set(
    subject.regions
      .map((region) => region.component)
      .filter((name): name is string => name !== undefined),
  );

  const moved = (subject.moved ?? []).map(
    (entry): Sensed => ({ ...entry, drawn: drawn.has(entry.component) }),
  );
  const stirred = new Set(moved.map((entry) => entry.component));

  return {
    measured: subject.moved !== undefined,
    moved,
    missed: moved.filter((entry) => entry.cause && !entry.drawn),
    // Only when the hashes were read. Without them every named region would land
    // here, and the page would report the whole build as collateral.
    pushed:
      subject.moved === undefined
        ? []
        : [...drawn].filter((name) => !stirred.has(name)).sort(),
  };
}

/** One component's movement across the renders a change showed up in. */
export interface Across {
  /**
   * Renders whose baseline carried hashes to compare — never their band count.
   *
   * Zero is the state every other field here is unreadable in: `bands: []` then
   * means *nothing was measured*, and printed as *nothing moved* it is a claim
   * made on the authority of something that never looked.
   */
  readonly measured: number;
  /** Every band this component moved in, anywhere, loudest first. */
  readonly bands: readonly string[];
  /** Renders it moved in where no region carried its name. */
  readonly missedIn: readonly string[];
  /** Renders whose baseline had no hashes, so nothing was measured there. */
  readonly unmeasured: readonly string[];
  /**
   * What else moved in the same renders, and in what sense.
   *
   * The answer to the complaint this page kept earning: a card whose price string
   * changed reports the button, because the button is what the largest box
   * resolved to. Naming the other movers with their own bands is what lets a
   * reviewer see that the text moved in the parent and the button moved in its
   * style — two edits, correctly separated, on one screen.
   */
  readonly alongside: readonly { readonly component: string; readonly bands: readonly string[] }[];
}

/**
 * The same reading, folded over every render one change appeared in.
 *
 * Union rather than intersection, and the difference is not cosmetic. A restyled
 * button in a card that also grew moves in `token` everywhere and in `geometry`
 * only where the row reflowed; an intersection would drop the second and report
 * a size change as a repaint.
 */
export function senseAcross(component: string, appearances: readonly Appearance[]): Across {
  const bands = new Set<string>();
  const missedIn: string[] = [];
  const unmeasured: string[] = [];
  const others = new Map<string, Set<string>>();

  for (const { subject } of appearances) {
    const sense = senseOfSubject(subject);
    if (!sense.measured) {
      unmeasured.push(subject.subject);
      continue;
    }

    for (const entry of sense.moved) {
      if (entry.component === component) {
        for (const band of entry.bands) bands.add(band);
        if (!entry.drawn) missedIn.push(subject.subject);
        continue;
      }
      const seen = others.get(entry.component) ?? new Set<string>();
      for (const band of entry.bands) seen.add(band);
      others.set(entry.component, seen);
    }
  }

  return {
    measured: appearances.length - unmeasured.length,
    bands: loudestFirst(bands),
    missedIn,
    unmeasured,
    alongside: [...others.entries()]
      .map(([name, seen]) => ({ component: name, bands: loudestFirst(seen) }))
      .sort((left, right) => left.component.localeCompare(right.component)),
  };
}

/**
 * Loudest first, and held here rather than imported.
 *
 * `BANDS` is `core`'s, and this package reads reports rather than core's compare
 * tier — a surface that pulled the ordering across would tie the words on a page
 * to a library it does not otherwise need.
 */
export const ORDER: readonly string[] = ['a11y', 'geometry', 'token', 'content', 'texture'];

/**
 * The known bands in their own order, then anything this build has not heard of.
 *
 * A newer report may carry a band added after this deployment shipped, and a
 * filter over {@link ORDER} would drop it — the surface would report four bands
 * where the run recorded five, and nothing on the page would say so. Unknown
 * words go last because the order is a loudness claim this build cannot make
 * about them, and alphabetically because that is an order rather than an
 * accident of iteration.
 */
export function loudestFirst(bands: Iterable<string>): readonly string[] {
  const present = new Set(bands);
  const known = ORDER.filter((band) => present.has(band));
  const rest = [...present].filter((band) => !ORDER.includes(band)).sort();
  return [...known, ...rest];
}

/** A render this component moved in that some other change owns. */
export interface Elsewhere {
  readonly subject: string;
  /** The change the docket filed this render under, when a region named one. */
  readonly filedUnder?: string;
  /** A region here carries this component, so its picture is a picture of it. */
  readonly drawn: boolean;
}

/**
 * The renders a change moved in and does not appear on.
 *
 * A subject is filed under the component its **leading region** resolved to, and
 * a render has exactly one of those — so a commit that edits a button and a
 * price string files every card under whichever of the two happened to own the
 * larger differing box. The button's page then lists seven renders of the twelve
 * it moved in, and says nothing at all about the other five.
 *
 * That is the reviewer's problem and not a presentation detail: pressing approve
 * on this page decides the renders on this page. The five it never mentioned
 * stay open, under a name the person looking for this change would not think to
 * open. Naming them is the difference between a docket and a docket that can be
 * finished.
 *
 * `here` is the set already listed, passed in rather than derived, because the
 * caller's list is the definition of *already shown* and re-deriving it here
 * would be a second opinion about the same question.
 */
export function movedElsewhere(
  component: string,
  subjects: readonly SubjectView[],
  here: ReadonlySet<string>,
): readonly Elsewhere[] {
  const found: Elsewhere[] = [];

  for (const subject of subjects) {
    if (subject.verdict !== 'changed') continue;
    if (here.has(subject.subject)) continue;
    // Caused, not merely moved. A render where this component's box was pushed
    // by somebody else's edit is not a render of this change, and listing it
    // would put the collateral the ranking exists to demote back on the page.
    const moved = (subject.moved ?? []).some(
      (entry) => entry.component === component && entry.cause,
    );
    if (!moved) continue;

    const under = causeOf(subject);
    found.push({
      subject: subject.subject,
      ...(under === undefined ? {} : { filedUnder: under }),
      drawn: subject.regions.some((region) => region.component === component),
    });
  }

  return found;
}

/**
 * What each band is read from, for the reviewer who asks how the page knows.
 *
 * *What it announces moved* is a claim, and until this line existed the page made
 * it with nothing behind it. It is a digest comparison: the run hashes the role,
 * name and state of every node inside a component boundary, the baseline sidecar
 * keeps that hash, and a later run's hash disagrees. Which is a real answer, and
 * also a short one — the values are not stored, so the band says *these differ*
 * and cannot say what the name became. Printing the first half without the second
 * lets a reviewer read a precision into it that is not there.
 */
export const READS: Readonly<Record<string, string>> = {
  a11y: 'the role, name and state of every node in it',
  geometry: 'its nodes’ boxes, and the layout properties they compute to',
  token: 'the style properties it declares, and the tokens behind them',
  content: 'the text its nodes carry',
  texture: 'the pixels themselves, after the other four agreed',
};
