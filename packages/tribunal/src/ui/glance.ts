/**
 * What a reviewer should see first, derived rather than read out of a sentence.
 *
 * The line this replaces was the run's own prose: *2,015 pixels differ across 1
 * region in Card, and the subject resized from 1280×394 to 1280×402; the
 * collection of this subject reported ignore-unmatched (warn), so what was
 * compared may be less than the whole subject.* Two hundred and twenty
 * characters, three clauses, and the one thing a person would have noticed —
 * **the card got eight pixels taller** — is in the middle of the second.
 *
 * It also names the wrong component. `describeChange` maps every region to its
 * name and never reads `cause`, so a change that reflowed its container is
 * reported under the container. On that subject `Card` is a passenger and
 * `Button` is the only entry the hashes mark as a cause, in `geometry` **and**
 * `token` — its own box and its own declared values both moved.
 *
 * ## The strip is three facts, and each is a measurement
 *
 * The cause, the growth, and the area. Nothing here is a sentence, because a
 * sentence has to be read in order and these are answers to three questions
 * asked at once — and because a reviewer who has read the same clause on twenty
 * subjects stops reading it on the twenty-first.
 *
 * ## What it cannot say, and why that is not this module's fault
 *
 * The edit was `h-9 rounded-md px-3` to `h-11 rounded-lg px-5`: eight pixels of
 * height, eight of horizontal padding, a larger radius. This can report the
 * height, because a document's dimensions are recorded on both sides. It cannot
 * report the padding, because a baseline keeps five digests per component and no
 * values, so *what it was* is not on disk anywhere. That is a capture decision
 * and it is the reason a band is called `token` rather than `--radius-md`.
 *
 * So the growth is printed as the growth, never as a property. A page that
 * guessed *padding* from a height delta would be right on this subject and wrong
 * on the first one that wrapped a line.
 *
 * What it can now say, since `ComponentHash.boxes`, is which control grew and by
 * how much: `Button +36 × +8 px` beside the canvas's own `+8 px taller`. Those
 * are two facts and the pair is the finding — the control got wider and the page
 * did not, so the width was absorbed by a row that had the room and the height
 * was not.
 */

import type { SubjectView } from '../review-types.js';
import { leadOf } from './lead.js';

/** The component the record blames, and how the two tiers found it. */
export interface Blamed {
  readonly component: string;
  readonly bands: readonly string[];
  /** A region in this render carries the name, so the picture found it too. */
  readonly drawn: boolean;
  /** Present on one side only — which `bands` alone cannot say. */
  readonly presence?: 'added' | 'removed';
  /**
   * How much its own box grew, when the record measured it.
   *
   * The answer this page existed without. A band says *not what it was*; this
   * says *thirty-six wider and eight taller*, which is the edit — and it is a
   * measurement of the control rather than of the canvas, so it survives on a
   * subject whose page height never moved.
   */
  readonly grew?: { readonly width: number; readonly height: number };
}

/** How the canvas itself moved, when it did. */
export interface Grew {
  readonly axis: 'taller' | 'shorter' | 'wider' | 'narrower' | 'resized';
  readonly by: number;
  readonly from: { readonly width: number; readonly height: number };
  readonly to: { readonly width: number; readonly height: number };
}

export interface Glance {
  /**
   * Every component whose own content moved, widest sense first.
   *
   * Empty is a real answer and not a missing one: the hashes were read and
   * nothing owned the difference, which is what the picture is left to explain.
   */
  readonly blamed: readonly Blamed[];
  /** `false` when the baseline carried no hashes, so none of the above was asked. */
  readonly measured: boolean;
  readonly grew?: Grew;
  readonly pixels: number;
  readonly regions: number;
  /**
   * The component the largest region resolved to, when no blame names it.
   *
   * The container that reflowed. Printed as what it is — where the pixels
   * landed — rather than as the subject of the change, which is the mistake the
   * prose line makes.
   */
  readonly landedIn?: string;
}

export function glanceOf(subject: SubjectView): Glance {
  const moved = subject.moved;
  const blamed = (moved ?? [])
    .filter((entry) => entry.cause)
    .map((entry) => ({
      component: entry.component,
      bands: entry.bands,
      drawn: subject.regions.some((region) => region.component === entry.component),
      ...(entry.presence === undefined ? {} : { presence: entry.presence }),
      ...(entry.grew === undefined ? {} : { grew: entry.grew }),
    }))
    .sort((left, right) => right.bands.length - left.bands.length ||
      left.component.localeCompare(right.component));

  const lead = leadOf(subject) ?? subject.regions[0];
  const landedIn =
    lead?.component !== undefined &&
    !blamed.some((entry) => entry.component === lead.component)
      ? lead.component
      : undefined;

  const grew = grewBy(subject);

  return {
    blamed,
    measured: moved !== undefined,
    ...(grew === undefined ? {} : { grew }),
    pixels: subject.changedPixels,
    regions: subject.regions.length,
    ...(landedIn === undefined ? {} : { landedIn }),
  };
}

/**
 * The canvas delta, named on the axis that moved.
 *
 * One axis is the ordinary case and the one worth a word: a component that got
 * taller pushed everything under it down, and *8 px taller* is the sentence a
 * reviewer would have written themselves. Both axes at once gets `resized` and
 * the larger magnitude, because there is no single number to lead with and
 * picking one would hide the other.
 */
function grewBy(subject: SubjectView): Grew | undefined {
  const to = subject.size;
  const from = subject.baseline;
  if (to === undefined || from === undefined) return undefined;

  const height = to.height - from.height;
  const width = to.width - from.width;
  if (height === 0 && width === 0) return undefined;

  const axis =
    height !== 0 && width !== 0
      ? 'resized'
      : height > 0
        ? 'taller'
        : height < 0
          ? 'shorter'
          : width > 0
            ? 'wider'
            : 'narrower';

  return { axis, by: Math.max(Math.abs(height), Math.abs(width)), from, to };
}
