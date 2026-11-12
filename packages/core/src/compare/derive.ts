import { digestCombine, digestValue, type Digest } from '../format/hash.js';
import type { SemanticSnapshot } from '../format/snapshot.js';
import type { EnvironmentDelta } from '../format/environment.js';
import { BANDS, type Band } from './band.js';
import type { Observability } from './observability.js';
import type { AggregateImpact } from './impact.js';
import { compareTrees, type ChangedComponent, type Delta, type Root } from './diff/index.js';

/**
 * One subject read as a variation of another.
 *
 * The same arithmetic a verdict is made of, pointed at a pair of subjects
 * somebody linked on purpose: a dark story against its light parent, a mobile
 * viewport against the desktop one, a story behind a feature flag against the
 * story it was copied from. Nothing here is compared against a baseline and
 * nothing here is a verdict — a variation *is* a difference, so reporting it as a
 * regression would be reporting the subject for existing.
 *
 * What it answers is the question a second case cannot: **a new story under a
 * flag is a new baseline and an empty diff, and everybody has to open two
 * pictures to see what the flag does.** Linked, the difference is a value with an
 * identity, and the identity is the useful part — see {@link Variation.digest}.
 */
export interface Variation {
  /** The variation's own subject id. */
  readonly subject: string;
  /** The subject it declares itself a variation of. */
  readonly parent: string;

  /** `true` when the two renders hash identically — the flag changed nothing. */
  readonly identical: boolean;

  readonly deltas: readonly Delta[];
  readonly roots: readonly Root[];
  readonly components: readonly ChangedComponent[];
  readonly impact: AggregateImpact;

  /** Bands the difference falls in, in band order. Empty when identical. */
  readonly bands: readonly Band[];

  /**
   * Bands **either** side's profile could not decide.
   *
   * Union rather than intersection, and never dropped: a jsdom side has no
   * geometry, and a variation that reported no geometry difference because
   * nothing could measure one would be the false `unchanged` this project exists
   * to refuse (ADR-0002).
   */
  readonly unobserved: readonly Band[];

  /**
   * How completely each band was decided, weaker side winning.
   *
   * A variation is the one comparison that crosses profiles on purpose, so this
   * is where the weaker-side rule has work to do: a dark story read in Chromium
   * against a light parent read in JSDOM is only as well observed as the JSDOM
   * side, band by band.
   */
  readonly observability: Readonly<Record<Band, Observability>>;

  /**
   * Bands decided on less than the evidence the band is made of.
   *
   * The pair is alike *there* in a narrower sense than elsewhere, and a report
   * that prints one word for both senses is the difference nobody can see.
   */
  readonly narrowed: readonly Band[];

  /**
   * Render inputs that differ between the two sides.
   *
   * Reported, never a refusal. A variation is frequently a *deliberate*
   * environment difference — a viewport, a colour scheme — and the field that
   * would make `diffSnapshots` refuse the pair is here the thing being examined.
   */
  readonly environmentDeltas: readonly EnvironmentDelta[];

  /**
   * The identity of the difference itself: `variation/v1` over the deltas.
   *
   * The field that makes a linked pair worth more than two pictures. A parent and
   * its variation both move by the same edit — a token changed, both re-render,
   * both go red — and this digest does not move, because what the variation *adds*
   * to its parent is unchanged. So the reviewer's question stops being "did these
   * two subjects change" and becomes "did what this flag does change", which is
   * the question they were trying to ask.
   *
   * Positions and values are in it and owner chains are not. An owner frame
   * carries a props digest per frame, so hashing it would make the identity move
   * whenever any component above the change was handed a different object —
   * which is a fact about the render, not about the difference.
   */
  readonly digest: Digest;
}

/**
 * Compare a variation against the subject it derives from.
 *
 * Refuses nothing. Two subject ids are the input this function exists for, and
 * two profiles or two environments are reported as part of the answer — see
 * `compareTrees` for why the refusals live with the caller that owes them rather
 * than with the arithmetic.
 */
export function deriveVariation(parent: SemanticSnapshot, variant: SemanticSnapshot): Variation {
  const compared = compareTrees(parent, variant);
  const moved = new Set(compared.deltas.map((delta) => delta.band));

  return {
    subject: variant.subject.id,
    parent: parent.subject.id,
    ...compared,
    bands: BANDS.filter((band) => moved.has(band)),
    digest: digestOfDifference(compared.deltas),
  };
}

/**
 * `variation/v1` over what each delta *is*, in the order the comparison produced.
 *
 * Order is the comparison's, which is a function of the two trees and of nothing
 * else — sorting here would cost a walk to buy stability the input already has.
 */
function digestOfDifference(deltas: readonly Delta[]): Digest {
  return digestCombine(
    'variation/v1',
    deltas.map((delta) =>
      digestValue({
        kind: delta.kind,
        band: delta.band,
        path: delta.path,
        property: delta.property,
        from: delta.from,
        to: delta.to,
      }),
    ),
  );
}
