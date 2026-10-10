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
import { Raster, type Size, union } from './plate.js';
import { Go, Prose } from './shell.js';

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
            {pictures === undefined ? null : <Pair variation={variation} pictures={pictures} />}
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
 * never measured falls to the tile's width, as an unmeasured layer does on the
 * plate.
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
  const scale = box === undefined ? undefined : Math.min(TILE.width / box.width, TILE.height / box.height, 1);

  return (
    <ul className="va-variation-pair">
      {parent === undefined ? null : <Side key="parent" side={parent} scale={scale} pictures={pictures} />}
      <Side key="arm" side={arm} scale={scale} pictures={pictures} />
    </ul>
  );
}

/** The largest a side is drawn, in CSS pixels; the subject page reads it at size. */
const TILE = { width: 220, height: 180 } as const;

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
  if (read?.has.after === true) return { id, read, kind: 'after', size: read.size };
  if (read?.has.before === true) return { id, read, kind: 'before', size: read.baseline };
  return { id, read, kind: undefined, size: undefined };
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

  return (
    <li>
      <Go to={{ page: 'subject', build, subject: id }} go={go} className="va-variation-side">
        {kind === undefined ? (
          // An `unchanged` subject keeps nothing, and one the run has no row for
          // was never read. An empty frame would read as a render that came out
          // blank, which is a third finding.
          <span className="va-variation-none">{read === undefined ? 'not in this run' : 'no image kept'}</span>
        ) : (
          // The name beneath labels the link; an alt repeating it is read twice.
          <Raster
            src={client.imageUrl(build, id, kind)}
            alt=""
            size={kind === 'after' ? size : undefined}
            style={
              size === undefined || scale === undefined
                ? undefined
                : { width: `${String(Math.round(size.width * scale))}px` }
            }
          />
        )}
        <span className="va-variation-name">{id}</span>
        {kind === 'before' ? <span className="va-how">baseline</span> : null}
      </Go>
    </li>
  );
}
