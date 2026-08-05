import type { Delta, Root } from '../compare/diff/delta.js';
import type { ChangeMask, DiffRegion } from '../attribute/mask.js';
import { digestString, type Digest } from '../format/hash.js';

/**
 * The shape of a difference, with its position and its values removed.
 *
 * Two digests, and the interesting thing about them is that they answer the same
 * question at different strengths. A **semantic** fingerprint knows which
 * component produced the difference and can therefore tell an identical-looking
 * change in `Avatar` from one in `Badge`. A **pixel** fingerprint knows only what
 * the residue looks like, so it collides where two unrelated components produce
 * similar shapes — and it is the only one available where no document survives.
 *
 * Both exist so that an ignore, or an acceptance, can be scoped to *what
 * happened* rather than to *where it landed* (spec 0024, ADR-0025). A coordinate
 * stops covering the thing it was drawn around the first time the layout moves; a
 * shape follows it. That is [`mask-fingerprint`](https://github.com/argos-ci/mask-fingerprint)'s
 * idea, and it is the right one.
 *
 * Separated from `ignore.ts` because ignoring is one of three things these are
 * for. `variance accept --shape` promotes a change everywhere it reached, a
 * report prints one beside every region so an operator can copy it, and an ignore
 * absorbs one — and a file named for the third would misdescribe the other two.
 */

/**
 * Field separator inside a digest input.
 *
 * A byte that cannot occur in a component name, a property or a band, so no two
 * different shapes can concatenate into the same string. A space would collide
 * the moment a value contained one, which is the collision `digestCombine` uses
 * the same character to avoid.
 */
const SEPARATOR = '\u0000';

/**
 * The shape of one difference: its kind, its band, and which property moved.
 *
 * Everything positional and everything valued is deliberately absent. Two deltas
 * with the same shape are the same *kind of thing happening*, which is the
 * equivalence a flake needs and the one a coordinate cannot express.
 */
export function shapeOfDelta(delta: Delta): string {
  return `${delta.kind}/${delta.band}/${delta.property ?? ''}`;
}

/**
 * A digest of a difference with its position and its values removed.
 *
 * Built from the root's kind, the multiset of its deltas' shapes, and the
 * component responsible — and from nothing else. The label is excluded on
 * purpose: `token:--brand-a` and `token:--brand-b` moving the same properties in
 * the same component are the same shape, and an operator silencing a themable
 * surface wants both. Where the *label* is the identity worth matching on, the
 * root id already exists and `Policy.alwaysAuthorized` already takes it.
 *
 * The `cause` is included, which is what keeps this from being too coarse: the
 * same shape in a different component is a different fingerprint, so silencing a
 * flake in `Avatar` does not silence the identical-looking regression in `Badge`.
 */
export function fingerprintOfRoot(root: Root): Digest {
  const shapes = root.deltas.map(shapeOfDelta).sort();
  return digestString(
    ['shape/v1', root.kind, root.cause ?? '', ...shapes].join(SEPARATOR),
  );
}

export interface MaskFingerprintOptions {
  /** Grid the cropped region is resampled onto. Larger is stricter. */
  readonly grid?: number;

  /** Fraction of a cell that must have changed for the cell to count as set. */
  readonly coverage?: number;
}

const DEFAULT_GRID = 12;
const DEFAULT_COVERAGE = 0.25;

/**
 * A digest of what a change *looks like*, for the tier that has no document.
 *
 * The region is cropped to its own bounding box and resampled onto a fixed grid,
 * so the same artifact three hundred pixels lower — a card that moved, a toast
 * that reappeared — produces the same digest. The aspect ratio is bucketed in
 * alongside it, coarsely, so a wide banner and a tall column cannot collide
 * merely by having similar interiors.
 *
 * This is [mask-fingerprint](https://github.com/argos-ci/mask-fingerprint)'s
 * move, and it is the right one: it is the only way an ignore can be scoped to a
 * *flake* rather than to a rectangle, which is the difference between silencing
 * one artifact and blinding a region.
 *
 * It is deliberately the weaker of the two fingerprints on this page. A pixel
 * shape knows nothing about who caused it, so two unrelated components producing
 * similar-looking residue collide — which is exactly why the semantic
 * fingerprint exists and is preferred wherever a document is available.
 */
export function fingerprintOfMask(
  mask: ChangeMask,
  region: DiffRegion,
  options: MaskFingerprintOptions = {},
): Digest {
  const grid = Math.max(1, Math.floor(options.grid ?? DEFAULT_GRID));
  const coverage = options.coverage ?? DEFAULT_COVERAGE;

  const width = Math.max(1, region.width);
  const height = Math.max(1, region.height);
  // Typed rather than plain arrays: the resample is the one hot loop on this
  // page, running once per region on every red raster comparison.
  const cells = new Uint32Array(grid * grid);
  const totals = new Uint32Array(grid * grid);

  for (let y = 0; y < height; y += 1) {
    const sourceY = region.y + y;
    if (sourceY < 0 || sourceY >= mask.height) continue;

    const row = ((y * grid) / height) | 0;
    const rowOffset = sourceY * mask.width;
    const cellRow = Math.min(row, grid - 1) * grid;

    for (let x = 0; x < width; x += 1) {
      const sourceX = region.x + x;
      if (sourceX < 0 || sourceX >= mask.width) continue;

      const cell = cellRow + Math.min(((x * grid) / width) | 0, grid - 1);
      totals[cell] = (totals[cell] ?? 0) + 1;
      if (mask.data[rowOffset + sourceX] !== 0) cells[cell] = (cells[cell] ?? 0) + 1;
    }
  }

  let bits = '';
  for (let index = 0; index < cells.length; index += 1) {
    const total = totals[index] ?? 0;
    const set = cells[index] ?? 0;
    bits += total > 0 && set / total >= coverage ? '1' : '0';
  }

  return digestString(
    ['mask/v1', aspectBucket(width, height), sizeBucket(width, height), bits].join(SEPARATOR),
  );
}

/**
 * Aspect ratio in coarse steps, so a shape is not required to keep its exact box.
 *
 * Halving steps rather than a continuous ratio: a region that grows by a pixel
 * must stay the same fingerprint, or the whole mechanism degrades into the
 * coordinate matching it exists to replace.
 */
function aspectBucket(width: number, height: number): string {
  const ratio = width / height;
  return String(Math.round(Math.log2(ratio) * 2));
}

/**
 * Extent in coarse doubling steps, so a shape ignore is scoped to a magnitude.
 *
 * Without it the digest is **scale-free**, and that is not a subtlety: solid
 * squares of 12, 16, 24, 36, 48, 96 and 120 device pixels all resample to twelve
 * rows of ones and all carry aspect `0`, so they produce one digest. A rule
 * written for a 12×12 flaky badge would absorb a 120×120 card that had gone
 * solid — an image that failed to load, a component that rendered as a filled
 * block — at a hundred times the area, and the subject would come back green.
 *
 * The geometric mean rather than the area, so this term and the aspect are in the
 * same units and one bucket step means one doubling of *linear* size. That bounds
 * over-absorption to under 2× in each dimension instead of leaving it unbounded,
 * which is the most a position-invariant digest can promise.
 */
function sizeBucket(width: number, height: number): string {
  return String(Math.round(Math.log2(Math.sqrt(width * height))));
}
