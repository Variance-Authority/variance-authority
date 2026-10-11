/**
 * The variation lattice, drawn — the half of a run that has no baseline in it.
 *
 * Apart from the build page because it answers a different question. A docket
 * says *what changed since last time*; this says *does the flag do anything*, and
 * nothing else in the product can: a subject added behind a flag is `new`, its
 * diff is empty, and the flag's effect is visible only by putting two pictures
 * side by side — the comparison nobody performs. The run already made it.
 */

import type { VariationRecord } from '@variance-authority/report';
import type { ReactElement } from 'react';
import type { SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import type { Route } from './route.js';
import { Raster, SMALLEST_SCALE, fit, type Size, union } from './plate.js';
import { Go, Prose } from './shell.js';
import { gridsOf, type VariationGrid } from './variation-grid.js';

/**
 * Every subject that was read against another subject in the same run.
 *
 * Nothing here is a verdict, and the section is deliberately not part of the
 * counts: a variation is a difference somebody declared on purpose, and reporting
 * one as a regression would be reporting a subject for existing.
 *
 * **The order is the point, and it is not the report's.** Two states come first,
 * because they are the two a reviewer can act on and both are silent everywhere
 * else:
 *
 * - **reaches nothing** — the pair renders to one hash. An A/B arm whose flag
 *   changes no pixel is an experiment measuring nothing, and it looks exactly like
 *   a healthy arm in every screenshot tool there is: two subjects, both
 *   `unchanged`, both green.
 * - **no parent in this run** — the declaration named a subject nothing observed.
 *   A broken link and an axis with nothing to say are not the same finding, so
 *   they are not drawn the same way.
 *
 * The rest follow by subject, which is the lattice's own order: a name that
 * extends another name sorts after it.
 *
 * **A subject varying on two axes is drawn once, as a grid**, above the list:
 * one axis down, the other across, every render in its cell. A pair compares the
 * combination of two flags with one neighbour; the grid puts it beside both, and
 * a combination nothing in the family is at is an empty cell saying so. Its
 * pairs stay in the list without their pictures, since the grid already holds
 * them.
 */
export function Variations({
  variations,
  pictures,
}: {
  readonly variations: readonly VariationRecord[];
  /**
   * Where each side's image comes from. Without it the list is names only, which
   * is all a host that serves no images can draw.
   */
  readonly pictures?: Pictures | undefined;
}): ReactElement | null {
  if (variations.length === 0) return null;

  const grids = pictures === undefined ? [] : gridsOf(variations);
  const gridded = new Set(grids.flatMap((grid) => grid.cells.flat()));

  const ordered = [...variations].sort((left, right) => {
    const byRank = rankOf(left) - rankOf(right);
    if (byRank !== 0) return byRank;
    return left.subject < right.subject ? -1 : left.subject > right.subject ? 1 : 0;
  });

  return (
    <>
      <h2>Variations</h2>
      <p className="va-note" style={{ marginBottom: '0.6rem' }}>
        Subjects read against the subject they vary from, in this run. Not verdicts — a variation is
        a difference somebody meant. What is worth reading is a variation that turns out to be no
        difference at all.
      </p>
      {pictures === undefined
        ? null
        : grids.map((grid) => <Grid key={grid.root} grid={grid} pictures={pictures} />)}
      <ul className="va-variation-list">
        {ordered.map((variation) => (
          <li key={variation.subject} className={`va-variation ${STATES[rankOf(variation)] ?? ''}`}>
            <p className="va-variation-head">
              <span className="va-axis">{axisOf(variation)}</span>
              <strong>{variation.subject}</strong>
              {variation.parent === undefined ? null : (
                <>
                  from <strong>{variation.parent}</strong>
                </>
              )}
              {variation.how === undefined ? (
                <span className="va-how">how this pair was found is unstated</span>
              ) : (
                <span className="va-how">{variation.how}</span>
              )}
              {variation.unobserved === undefined || variation.unobserved.length === 0 ? null : (
                // Absent is not "none", so this appears only when the run said so.
                // A band no profile could decide is a band nobody should read this
                // variation as clean in.
                <span className="va-how">undecided in {variation.unobserved.join(', ')}</span>
              )}
            </p>
            <p className="va-because"><Prose text={variation.because} /></p>
            {pictures === undefined || gridded.has(variation.subject) ? null : (
              <Pair variation={variation} pictures={pictures} />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** One class per rank, so the ordering and the drawing cannot disagree. */
const STATES: readonly string[] = ['va-inert', 'va-unlinked', ''];

function rankOf(variation: VariationRecord): number {
  if (variation.identical === true) return 0;
  if (variation.identical === undefined) return 1;
  return 2;
}

/**
 * The axis, in the words the record earned.
 *
 * `identical === undefined` is not `differs`: nothing compared the pair, and the
 * only honest short label for that is that nothing did. The distinction is the
 * same one the column keeps nullable for.
 */
function axisOf(variation: VariationRecord): string {
  if (variation.identical === undefined) return 'not compared';
  if (variation.identical) return 'reaches nothing';
  const bands = variation.bands ?? [];
  return bands.length === 0 ? 'differs' : bands.join(' · ');
}

/** What a variation needs to draw its two sides: the build's images and its pages. */
export interface Pictures {
  readonly client: ReviewClient;
  readonly build: string;
  readonly subjects: readonly SubjectView[];
  readonly go: (route: Route) => void;
}

/**
 * The parent and the arm, side by side, each a link to its own page.
 *
 * The list above says what the run measured; this is the comparison it measured,
 * which a reviewer otherwise makes by opening two pages and remembering one. The
 * parent comes first because the arm is read as the parent plus an axis.
 *
 * Both sides are scaled by one factor: the one that fits the box holding both
 * into a tile. Each shrunk to its own tile, a narrower arm would be drawn larger
 * than its parent and the pair would differ everywhere. A side whose size was
 * never measured is bounded by the tile instead, since no scale can place it.
 */
function Pair({
  variation,
  pictures,
}: {
  readonly variation: VariationRecord;
  readonly pictures: Pictures;
}): ReactElement {
  const arm = sideOf(variation.subject, pictures.subjects);
  const parent = variation.parent === undefined ? undefined : sideOf(variation.parent, pictures.subjects);
  const box = union(parent?.size, arm.size);
  const scale = box === undefined ? undefined : scaleOf(box);

  return (
    <ul className="va-variation-pair">
      {parent === undefined ? null : <Side key="parent" side={parent} scale={scale} pictures={pictures} />}
      <Side key="arm" side={arm} scale={scale} pictures={pictures} />
    </ul>
  );
}

/**
 * A root and its variations on two axes, every render at one magnification.
 *
 * The scale is the one that fits the largest render into a tile, for the reason
 * a pair shares one: a cell drawn larger than its neighbour reads as a change.
 */
function Grid({
  grid,
  pictures,
}: {
  readonly grid: VariationGrid;
  readonly pictures: Pictures;
}): ReactElement {
  const { rows, columns } = grid;
  const box = grid.cells
    .flat()
    .reduce<Size | undefined>(
      (sized, id) => (id === undefined ? sized : union(sized, sideOf(id, pictures.subjects).size)),
      undefined,
    );
  const scale = box === undefined ? undefined : scaleOf(box);

  return (
    <div className="va-variation-grid-block">
      <p className="va-variation-head">
        <span className="va-axis">
          {rows.axis} × {columns.axis}
        </span>
        <strong>{grid.root}</strong>
      </p>
      <div className="va-variation-grid-scroll">
        <table className="va-variation-grid">
          <thead>
            <tr>
              <th scope="col">
                <code>{rows.axis}</code> ↓ <code>{columns.axis}</code> →
              </th>
              {columns.values.map((column) => (
                <th scope="col" key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.values.map((row, r) => (
              <tr key={row}>
                <th scope="row">{row}</th>
                {columns.values.map((column, c) => {
                  const id = grid.cells[r]?.[c];
                  return (
                    <td key={column}>
                      {id === undefined ? (
                        // A combination nothing in this family is at, which a
                        // list of pairs has no place to show. Only the family:
                        // a subject linked from elsewhere may be there.
                        <span className="va-variation-none va-note">
                          {/* One flex item, so the sentence wraps as a sentence. */}
                          <span>
                            nothing varying from <code>{grid.root}</code> is <code>{rows.axis}</code> {row} and{' '}
                            <code>{columns.axis}</code> {column}
                          </span>
                        </span>
                      ) : (
                        <ul className="va-variation-pair">
                          <Side side={sideOf(id, pictures.subjects)} scale={scale} pictures={pictures} />
                        </ul>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The largest a side is drawn, in CSS pixels; the subject page reads it at size. */
const TILE = { width: 220, height: 180 } as const;

/** The scale that fits `box` into a tile, or the floor when nothing above it does. */
function scaleOf(box: Size): number {
  return Math.max(SMALLEST_SCALE, fit(box, TILE));
}

interface SideOf {
  readonly id: string;
  /** Absent when the run has no row for this subject: it was never read. */
  readonly read: SubjectView | undefined;
  readonly kind: 'after' | 'before' | undefined;
  readonly size: Size | undefined;
}

/**
 * The image that shows this subject: the candidate when the run kept one, the
 * baseline when it kept only that, and nothing when it kept neither — with the
 * dimensions that belong to that image, never the other one's.
 */
function sideOf(id: string, subjects: readonly SubjectView[]): SideOf {
  const read = subjects.find((each) => each.subject === id);
  if (read?.has.after === true) return { id, read, kind: 'after', size: measured(read.size) };
  if (read?.has.before === true) return { id, read, kind: 'before', size: measured(read.baseline) };
  return { id, read, kind: undefined, size: undefined };
}

/** A recorded size no scale can come from — an empty side — is no measurement. */
function measured(size: Size | undefined): Size | undefined {
  return size !== undefined && size.width > 0 && size.height > 0 ? size : undefined;
}

function Side({
  side,
  scale,
  pictures,
}: {
  readonly side: SideOf;
  readonly scale: number | undefined;
  readonly pictures: Pictures;
}): ReactElement {
  const { client, build, go } = pictures;
  const { id, read, kind, size } = side;
  // Above the tile only at the floor: the rest of it is on the subject page.
  const cropped =
    kind !== undefined &&
    size !== undefined &&
    scale !== undefined &&
    // Rounded as drawn: a fitted 400 × 0.55 is 220.00000000000003.
    (Math.round(size.width * scale) > TILE.width || Math.round(size.height * scale) > TILE.height);

  // The build has no page for a subject it never read, so that side is not a link.
  if (read === undefined) {
    return (
      <li className="va-variation-side">
        <span className="va-variation-none va-note">not in this run</span>
        <span className="va-variation-name">{id}</span>
      </li>
    );
  }

  return (
    <li>
      <Go to={{ page: 'subject', build, subject: id }} go={go} className="va-variation-side">
        {kind === undefined ? (
          // An `unchanged` subject keeps nothing. An empty frame would read as a
          // render that came out blank, which is another finding.
          <span className="va-variation-none va-note">no image kept</span>
        ) : (
          <Cropped when={cropped}>
            {/* The name beneath labels the link; an alt repeating it is read twice. */}
            <Raster
              src={client.imageUrl(build, id, kind)}
              alt=""
              size={size}
              style={
                size === undefined || scale === undefined
                  ? // Nothing measured places this side, so the tile bounds it.
                    { maxWidth: `${String(TILE.width)}px`, maxHeight: `${String(TILE.height)}px` }
                  : { width: `${String(Math.round(size.width * scale))}px` }
              }
            />
          </Cropped>
        )}
        <span className="va-variation-name">{id}</span>
        {cropped ? <span className="va-how">cropped to its top-left corner, at quarter size</span> : null}
        {kind === 'before' ? <span className="va-how">baseline</span> : null}
      </Go>
    </li>
  );
}

/** The tile's window onto a side drawn larger than it, from the top-left corner. */
function Cropped({ when, children }: { readonly when: boolean; readonly children: ReactElement }): ReactElement {
  if (!when) return children;
  return (
    <span
      className="va-variation-crop"
      style={{ maxWidth: `${String(TILE.width)}px`, maxHeight: `${String(TILE.height)}px` }}
    >
      {children}
    </span>
  );
}
