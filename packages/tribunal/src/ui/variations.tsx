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
 */
function Pair({
  variation,
  pictures,
}: {
  readonly variation: VariationRecord;
  readonly pictures: Pictures;
}): ReactElement {
  return (
    <ul className="va-variation-pair">
      {variation.parent === undefined ? null : <Side key="parent" id={variation.parent} pictures={pictures} />}
      <Side key="arm" id={variation.subject} pictures={pictures} />
    </ul>
  );
}

function Side({ id, pictures }: { readonly id: string; readonly pictures: Pictures }): ReactElement {
  const { client, build, subjects, go } = pictures;
  const read = subjects.find((each) => each.subject === id);
  const kind = keptOf(read);

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
          <img src={client.imageUrl(build, id, kind)} alt="" loading="lazy" />
        )}
        <span className="va-variation-name">{id}</span>
        {kind === 'before' ? <span className="va-how">baseline</span> : null}
      </Go>
    </li>
  );
}

/**
 * The image that shows this subject: the candidate when the run kept one, the
 * baseline when it kept only that, and nothing when it kept neither. The label
 * under a baseline says so, because it is the picture before this commit.
 */
function keptOf(subject: SubjectView | undefined): 'after' | 'before' | undefined {
  if (subject === undefined) return undefined;
  if (subject.has.after) return 'after';
  if (subject.has.before) return 'before';
  return undefined;
}
