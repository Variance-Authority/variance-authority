/**
 * What the record says about one change, before anybody decides it.
 *
 * Seven readings, and not one of them is an act. [`change.tsx`](./change.tsx)
 * holds the page and the two buttons; this holds every sentence printed above
 * them, which is the half that has to be argued rather than wired — what counts
 * as *reached*, what a silence is allowed to imply, and which of two absences a
 * reviewer is looking at. Splitting them keeps the argument readable and stops
 * the page that carries the decision from being mostly prose about it.
 *
 * The rule they share: absent is not empty. A run that read no diff, a component
 * the source index does not declare, a render nobody wrote a reach row for and a
 * build that counted no collateral each get their own sentence or no sentence at
 * all, because the alternative is spending this product’s loudest line on its
 * most ordinary fact and training the reader out of it.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Churn } from '@variance-authority/history';
import type { BuildDetail } from '../review-types.js';
import type { ReviewClient } from './client.js';
import type { Crossing } from './crossing.js';
import { shapesOf, type Appearance, type Origin } from './grouping.js';
import { ChurnLine } from './history.js';
import type { Shifted } from './shift.js';
import { count, number } from './text.js';

/**
 * How far this change went, said in renders and shapes rather than in pixels.
 *
 * The number this used to lead with was a pixel total, which is the least useful
 * figure available: it is one number for every size of change, and on the restyle
 * that moves everything it degenerates into a quantity nobody can act on. Renders
 * are what is being decided, and distinct shapes say whether deciding them once
 * is honest.
 */
export function Spread({ origin }: { readonly origin: Origin }): ReactElement {
  const shapes = shapesOf(origin.appearances).size;
  const where = count(origin.appearances.length, 'render');

  if (shapes === 0) {
    return (
      <>
        <strong>{where}</strong> moved, and this run recorded no shape for any of them — so nothing
        says whether they moved the same way. {number(origin.pixels)} px in total.
      </>
    );
  }

  return (
    <>
      <strong>
        {shapes === 1 ? 'One difference' : count(shapes, 'distinct difference')}, in {where}
      </strong>
      . {number(origin.pixels)} px in total.
    </>
  );
}

/**
 * Where this component is declared, and what it means when nothing says.
 *
 * A blank is the one answer this cell must not give. The reviewer's next move on
 * a change they do not recognise is to open the file, and *nothing here* reads as
 * a defect in the tool — when the ordinary cause is that the name belongs to a
 * dependency, which the source index scans no part of and never claimed to. So
 * the two silences are separated: a run that resolved files for other components
 * has said something about this one, and a run that resolved none has not.
 */
export function Declared({
  file,
  sourced,
}: {
  readonly file?: string | undefined;
  readonly sourced: boolean;
}): ReactElement {
  if (file !== undefined) return <code className="va-file">{file}</code>;

  return (
    <span
      className="va-note"
      title={
        sourced
          ? 'This run resolved files for other components in this build, so this is a name its source index does not declare — a component out of a dependency, or one produced at build time.'
          : 'This run resolved no source files at all, so nothing here says where any of these components are declared.'
      }
    >
      {sourced ? 'not in the scanned source' : 'no source index'}
    </span>
  );
}

/**
 * Whether the commit arrives here, said in five states rather than two.
 *
 * A run with no diff read cannot say, and saying nothing is the only honest
 * version of that. Silence would be indistinguishable from *reached*, which is
 * the assumption a reviewer makes by default and the one that costs them.
 *
 * The last of the five is now conditional: it is a reconstruction, and it stands
 * down where the run recorded a conclusion of its own. See the branch below.
 *
 * The rest is the split this card got wrong twice. `reached` is computed against
 * the components the diff can arrive at, so a component the graph carries nowhere
 * — anything out of `node_modules`, which is most of the host nodes on a real
 * page — can never be in that set whatever the commit did. And a render the reach
 * record has no row for is not a render the commit fails to reach; it is a render
 * nobody wrote down. Printing *nothing reaches it and it moved anyway* over
 * either of those spends the loudest sentence on the page on the most ordinary
 * fact about it, and by the time a real orphan appears the sentence has been
 * trained out of the reader.
 */
export function Arrival({ origin }: { readonly origin: Origin }): ReactElement | null {
  if (origin.reached === undefined) return null;

  if (origin.reached) {
    const trail = origin.trail;
    return (
      <p className="va-reaches va-reached">
        {trail === undefined ? (
          'This commit reaches it.'
        ) : (
          <>
            This commit reaches it:{' '}
            {trail.map((step, index) => (
              <span key={step}>
                {index === 0 ? null : <span className="va-arrow">→</span>}
                {index === trail.length - 1 ? <strong>{step}</strong> : <code>{step}</code>}
              </span>
            ))}
          </>
        )}
      </p>
    );
  }

  const stranded = origin.stranded ?? [];
  const unlisted = origin.unlisted ?? [];
  const through = origin.through ?? [];

  if (stranded.length > 0) {
    return (
      <p className="va-reaches va-alarm">
        This commit reaches nothing at all in {count(stranded.length, 'render')} it moved in —{' '}
        {stranded.slice(0, 3).join(', ')}
        {stranded.length > 3 ? `, and ${count(stranded.length - 3, 'other')}` : ''}. Something
        changed there that the diff cannot account for.
      </p>
    );
  }

  // The run's own conclusion supersedes the rest of this, and `Because` has
  // already printed it directly above. What follows is a reconstruction from the
  // reach record alone — and on a component the import walk merely climbed past,
  // it reads *this comes from a dependency* about a file named at the top of this
  // same page. The one thing it says that the conclusion does not is the gap in
  // the record, so that is what survives.
  if (origin.cause !== undefined) {
    return unlisted.length === 0 ? null : (
      <p className="va-reaches va-unnamed">
        <Unlisted renders={unlisted.length} />
      </p>
    );
  }

  return (
    <p className="va-reaches va-unnamed">
      The commit reaches nothing called <strong>{origin.component}</strong> — the file graph carries
      no such name, which is what a component out of a dependency looks like from here.{' '}
      {through.length === 0
        ? 'It does reach every render this moved in, without naming a component in any of them.'
        : `It does reach every render this moved in, through ${through.slice(0, 4).join(', ')}${
            through.length > 4 ? ` and ${count(through.length - 4, 'other')}` : ''
          } — so either one of those drew this node, or something reaches it that the graph does not model.`}
      {unlisted.length === 0 ? null : (
        <>
          {' '}
          <Unlisted renders={unlisted.length} />
        </>
      )}
    </p>
  );
}

/**
 * The renders the reach record has no row for.
 *
 * Not *the commit does not reach these*. Nobody wrote them down, and a page that
 * folded the two together would report a gap in its own record as a finding about
 * the commit.
 */
function Unlisted({ renders }: { readonly renders: number }): ReactElement {
  return (
    <>
      {count(renders, 'render')} it moved in {renders === 1 ? 'has' : 'have'} no reach recorded at
      all, so nothing the commit reaches was ever weighed against{' '}
      {renders === 1 ? 'it' : 'them'}.
    </>
  );
}

/**
 * What the run before this one had to say about these renders.
 *
 * The sentence a reviewer skips work on, and the reason it is here rather than in
 * the crossing panel: *build 5 already showed you this, and nobody decided it* is
 * worth reading beside the change it is about and worth nothing at the bottom of
 * a page about twenty other subjects. The undecided count is the part that is
 * never printed anywhere else — it is the docket being delivered twice.
 */
export function SinceLast({
  crossing,
  origin,
}: {
  readonly crossing: Crossing;
  readonly origin: Origin;
}): ReactElement | null {
  if (crossing.state !== 'ready') return null;

  const rows = origin.appearances
    .map(({ subject }) => crossing.of(subject.subject))
    .filter((row): row is Shifted => row !== undefined);
  if (rows.length === 0) return null;

  const against = `build ${crossing.earlier.build}`;
  const seen = rows.filter((row) => row.shift === 'again');
  const undecided = seen.filter((row) => row.earlier?.decision == null).length;
  const moved = rows.filter((row) => row.shift === 'differently').length;
  const first = rows.filter((row) => row.shift === 'first').length;
  const fresh = rows.filter((row) => row.shift === 'new').length;

  if (seen.length === 0 && moved === 0 && first === 0 && fresh === 0) return null;

  return (
    <p className={seen.length > 0 ? 'va-since va-known' : 'va-since'}>
      {seen.length === 0 ? null : (
        <>
          {seen.length === rows.length ? 'Every one of these' : count(seen.length, 'of these')}{' '}
          carried the same difference in {against}
          {undecided === 0
            ? ', and every one was decided there.'
            : undecided === seen.length
              ? ', and none of them was decided there.'
              : `, and ${number(undecided)} of them went undecided there.`}{' '}
        </>
      )}
      {moved === 0 ? null : (
        <>
          {count(moved, 'render')} differed in {against} too, but not in the same way: the
          difference itself changed between the two builds.{' '}
        </>
      )}
      {first === 0 ? null : (
        <>
          {count(first, 'render')} moved for the first time; {against} compared{' '}
          {first === 1 ? 'it' : 'them'} and found nothing.{' '}
        </>
      )}
      {fresh === 0 ? null : <>{count(fresh, 'render')} did not exist in {against}.</>}
    </p>
  );
}

/**
 * A shape at reading length, with the whole of it a hover away.
 *
 * The digest is thirty-two hexadecimal characters and a reviewer needs none of
 * them: it is an identity, and an identity is only ever typed by copying it. A
 * prefix says *this one and not that one* on a page that never shows two, which
 * is the whole of the job the full string was doing on the surface.
 */
function brief(shape: string): string {
  return shape.length <= 14 ? shape : `${shape.slice(0, 14)}…`;
}

/**
 * Which of these differences are the same difference.
 *
 * A shape is a pixel digest with position and values removed, so one restyle
 * lands as one shape on the buttons that are the same size and another on the one
 * that is not. That is why it does not decide the group — and why it is worth
 * printing under a group it did not decide: a single shape across every render is
 * a set `variance accept --shape` can take by name in the next run.
 */
export function Shapes({
  appearances,
}: {
  readonly appearances: readonly Appearance[];
}): ReactElement {
  const clusters = shapesOf(appearances);
  if (clusters.size === 0) return <></>;

  const [shape, largest] = [...clusters.entries()].sort((left, right) => right[1] - left[1])[0]!;

  if (clusters.size === 1 && largest === appearances.length) {
    return (
      <p className="va-note">
        The same difference in every one of them. <code>variance accept --shape {shape}</code> takes
        exactly this set.
      </p>
    );
  }

  return (
    <p className="va-note">
      The largest of the {count(clusters.size, 'shape')} is {number(largest)} of the{' '}
      {count(appearances.length, 'render')} — <code title={shape}>{brief(shape)}</code>, which{' '}
      <code>variance accept --shape</code> takes by name. One component absorbing a change several
      ways is ordinary; the shapes are which of them recur.
    </p>
  );
}

/**
 * How often this component moves, asked on mount: there is one change on this page.
 *
 * Named for the question rather than the call, and not `Record`, which is a
 * global type every other file in this package is entitled to use.
 */
export function Recurrence({
  client,
  component,
}: {
  readonly client: ReviewClient;
  readonly component: string;
}): ReactElement | null {
  const [churn, setChurn] = useState<Churn | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setChurn(await client.churn(component));
    } catch {
      // A missing record is a silence this page can afford. Everything above it
      // is a reading of this build, and none of it becomes less true because the
      // history service did not answer.
      setChurn(null);
    }
  }, [client, component]);

  useEffect(() => {
    void load();
  }, [load]);

  // `0 of 0 runs` on every change is the shape of an answer with none of the
  // substance, and this is a reading of *this* build — history is an addition
  // where there is history, not a line that has to be filled.
  if (churn === null || churn.runs === 0) return null;

  return <ChurnLine component={component} churn={churn} />;
}

/**
 * Collateral, and nothing at all when the build did not count it.
 *
 * One number for the whole build, repeated onto every cause row by the store —
 * which is exactly why it is printed once, here, and never attributed to a
 * change. Deciding which edit pushed which box around is the attribution the
 * semantic tier declined to make. The guard is the rule: a build with no causes
 * has not counted zero collateral pixels, it has counted none, and `0 collateral
 * pixels` reads as a measurement.
 */
export function Collateral({ build }: { readonly build: BuildDetail }): ReactElement | null {
  const pixels = build.causes[0]?.collateralPixels;
  if (pixels === undefined || pixels === 0) return null;

  return (
    <p className="va-note va-collateral-note">
      {count(pixels, 'collateral pixel')} moved in this build alongside the changes — regions that
      shifted because something else did. Counted for the build, never split between the changes.
    </p>
  );
}
