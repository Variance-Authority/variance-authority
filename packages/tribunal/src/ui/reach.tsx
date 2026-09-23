/**
 * What the commit reaches, crossed against what the run saw.
 *
 * Every other panel on this page answers *what changed*. This one answers *what
 * could have*, and the whole value is in the crossing: a verdict alone cannot say
 * whether a green subject was supposed to be green, and a diff alone cannot say
 * whether the file somebody edited paints anything at all.
 *
 * Four states come out of it, and two are findings no image comparison can reach:
 *
 * - **reached, and moved** — the expected case, and the trail names the file.
 * - **reached, and still** — the commit reaches this subject and changed no pixel
 *   in it. Every tool in this category is silent about a green subject, so an
 *   author who believed they were changing this surface learns it here or not at
 *   all.
 * - **moved, unreached** — nothing in the commit arrives here and it moved anyway.
 *   That is a flake, an input from outside the repository, or a hole in the scan,
 *   and only the record separates them — so the record is read without waiting to
 *   be asked.
 * - **untouched, and still** — counted, never listed. On a narrowed run it reads
 *   *untouched, not rendered* instead, because those subjects were ruled out
 *   before any browser opened them and were never compared to anything.
 *
 * ## A refusal is drawn instead of the grid, not beside it
 *
 * A run can carry a diff it could not attribute: a changed file the graph does not
 * hold, a diff with nothing in the graph at all, a diff arriving at no component.
 * The store keeps that apart from an attribution that genuinely reached nothing,
 * and so does this. An empty grid over a refusal reads as *this commit reaches
 * none of your subjects*, which is a sentence somebody merges on.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Flakiness } from '@variance-authority/history';
import type { BuildDetail, ReachView, SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { StabilityLine } from './history.js';
import { OutcomeMapView } from './outcome.js';
import { briefly, count, number } from './text.js';

/**
 * The four states, and the two counts that keep them honest.
 *
 * `unplaced` and `incomparable` exist so the four quadrants add up to the suite
 * without any of them absorbing a subject nobody can classify. A baseline that
 * recorded no component list cannot be put on either axis, and a subject that is
 * new or that nothing could compare has no *moved* to speak of. Folding either
 * into the quiet quadrant would make the one nobody reads the place uncertainty
 * goes to die.
 */
export interface Crossing {
  readonly reachedMoved: readonly SubjectView[];
  readonly reachedStill: readonly SubjectView[];
  readonly unreachedMoved: readonly SubjectView[];
  readonly unreachedStill: number;
  /**
   * Out of reach and never rendered, because the run worked that out first.
   *
   * Apart from `unreachedStill` and never added to it. Those were opened and
   * found identical; these were never opened at all, and a page that summed them
   * would report a comparison for eighteen subjects no browser ever loaded.
   */
  readonly unreachedSkipped: number;
  readonly unplaced: number;
  readonly incomparable: number;
}

export function crossReach(
  subjects: readonly SubjectView[],
  reach: ReachView,
  notObserved: BuildDetail['notObserved'] = [],
): Crossing {
  const placed = reach.subjects;
  const reachedMoved: SubjectView[] = [];
  const reachedStill: SubjectView[] = [];
  const unreachedMoved: SubjectView[] = [];
  let unreachedStill = 0;
  let unplaced = 0;
  let incomparable = 0;

  for (const subject of subjects) {
    const entry = placed?.[subject.subject];
    if (entry === undefined) {
      unplaced += 1;
    } else if (subject.verdict === 'changed') {
      (entry.reached ? reachedMoved : unreachedMoved).push(subject);
    } else if (subject.verdict === 'unchanged') {
      // `changed` and `unchanged` are the only verdicts describing a pair this
      // run actually compared. A new subject has no baseline to have moved from,
      // and an incomparable one is a comparison that did not happen — neither
      // belongs on an axis called moved.
      if (entry.reached) reachedStill.push(subject);
      else unreachedStill += 1;
    } else {
      incomparable += 1;
    }
  }

  return {
    reachedMoved,
    reachedStill,
    unreachedMoved,
    unreachedStill,
    unreachedSkipped: notObserved.filter((entry) => entry.kind === 'unreached').length,
    unplaced,
    incomparable,
  };
}

/** How many unexplained subjects read their own record without being asked. */
const ASKED = 5;

/** How many trails are drawn before the rest are counted. */
const TRAILS = 8;

export function ReachPanel({
  client,
  build,
}: {
  readonly client: ReviewClient;
  readonly build: BuildDetail;
}): ReactElement | null {
  const reach = build.reach;
  if (reach === null) return null;

  return (
    <section className="va-card va-reach">
      <h2>What this commit reaches</h2>
      <p className="va-subtitle">
        {count(reach.changed.length, 'file')} changed against <code>{reach.against}</code>. The
        import graph carries them to {count(reach.components.length, 'component')}; the baselines say
        which subjects render those.
      </p>

      <OutcomeMapView build={build} />

      {reach.whole === undefined ? (
        <Crossed client={client} build={build} reach={reach} />
      ) : (
        <p className="va-refusal">
          This diff was not attributed, so nothing here may be called unreached: {reach.whole}.
        </p>
      )}

      <Holes reach={reach} />
    </section>
  );
}

function Crossed({
  client,
  build,
  reach,
}: {
  readonly client: ReviewClient;
  readonly build: BuildDetail;
  readonly reach: ReachView;
}): ReactElement {
  const crossing = crossReach(build.subjects, reach, build.notObserved);

  return (
    <>
      <div className="va-quad">
        <Cell
          tone="va-expected"
          n={crossing.reachedMoved.length}
          title="reached, and moved"
          note="The commit arrives and the render changed. What the edit was for."
        />
        <Cell
          tone="va-alarm"
          n={crossing.unreachedMoved.length}
          title="moved, unreached"
          note="Nothing in this commit arrives here. It moved anyway."
        />
        <Cell
          tone="va-inert"
          n={crossing.reachedStill.length}
          title="reached, and still"
          note="The commit arrives and changed no pixel of it."
        />
        {crossing.unreachedSkipped === 0 ? (
          <Cell
            tone="va-quiet"
            n={crossing.unreachedStill}
            title="untouched, and still"
            note="Out of the commit's reach, and unchanged."
          />
        ) : (
          // The run narrowed to what the diff can arrive at, so these were never
          // opened. Drawn as *not rendered* rather than *unchanged*: nothing
          // compared them, and the quadrant that says otherwise would be the one
          // place on the page claiming a result for work nobody did.
          <Cell
            tone="va-quiet"
            n={crossing.unreachedSkipped}
            title="untouched, not rendered"
            note="Out of the commit's reach, so this run never opened them."
          />
        )}
      </div>

      {crossing.unreachedMoved.length === 0 ? null : (
        <section className="va-band va-alarm">
          <h3>Moved with nothing reaching it</h3>
          <p className="va-note">
            The graph placed every changed file and none of them arrives here. Either this run read
            the subject differently from the last, something outside the repository moved, or the
            scan has a hole in it — and the record is what tells those apart.
          </p>
          <ul className="va-reach-list">
            {crossing.unreachedMoved.map((subject, index) => (
              <li key={subject.subject}>
                <strong>{subject.subject}</strong>{' '}
                <span className="va-note">
                  {briefly(subject)} moved
                </span>
                {index < ASKED ? <Journey client={client} subject={subject.subject} /> : null}
              </li>
            ))}
          </ul>
          {crossing.unreachedMoved.length <= ASKED ? null : (
            <p className="va-note">
              The record was read for the first {number(ASKED)}. Open the rest from the rail.
            </p>
          )}
        </section>
      )}

      {crossing.reachedStill.length === 0 ? null : (
        <section className="va-band va-inert">
          <h3>Reached, and did not move</h3>
          <p className="va-note">
            The commit arrives at these and the render is identical to the baseline. Nothing else on
            this page says anything at all about a green subject.
          </p>
          <ul className="va-reach-list va-columns">
            {crossing.reachedStill.map((subject) => (
              <li key={subject.subject}>
                <strong>{subject.subject}</strong>{' '}
                <Via through={reach.subjects?.[subject.subject]?.through ?? []} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <Trails reach={reach} />
      <Unplaced crossing={crossing} />
    </>
  );
}

function Cell({
  tone,
  n,
  title,
  note,
}: {
  readonly tone: string;
  readonly n: number;
  readonly title: string;
  readonly note: string;
}): ReactElement {
  // A zero is drawn quietly rather than hidden. An omitted quadrant reads as a
  // question that was not asked; a zero is the answer to it.
  return (
    <div className={n === 0 ? `va-cell ${tone} va-zero` : `va-cell ${tone}`}>
      <span className="va-cell-n va-num">{number(n)}</span>
      <span className="va-cell-title">{title}</span>
      <span className="va-cell-note">{note}</span>
    </div>
  );
}

/**
 * The chains, which are the part a reviewer can check.
 *
 * A component named without its chain is an assertion. `tokens.css →
 * button.tsx → Button` is a claim somebody can open three files and disprove,
 * which is the only kind worth putting on a review surface.
 */
function Trails({ reach }: { readonly reach: ReachView }): ReactElement | null {
  if (reach.components.length === 0) return null;
  const shown = reach.components.slice(0, TRAILS);

  return (
    <section className="va-band">
      <h3>How the diff arrives</h3>
      <ul className="va-trails">
        {shown.map((entry) => (
          <li key={entry.component}>
            {entry.trail.map((step, index) => (
              <span key={step}>
                {index === 0 ? null : <span className="va-arrow">→</span>}
                {index === entry.trail.length - 1 ? <strong>{step}</strong> : <code>{step}</code>}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {reach.components.length <= shown.length ? null : (
        <p className="va-note">
          {count(reach.components.length - shown.length, 'further component')} reached, not listed.
        </p>
      )}
    </section>
  );
}

/**
 * The subjects the crossing could not seat, said rather than absorbed.
 *
 * Two different silences, kept as two. A subject whose baseline carries no
 * component list is one this surface cannot answer for; a new or incomparable
 * subject is one where the question does not apply. Printing a single number for
 * both would invite the reader to fix the wrong thing.
 */
function Unplaced({ crossing }: { readonly crossing: Crossing }): ReactElement | null {
  if (crossing.unplaced + crossing.incomparable === 0) return null;

  return (
    <p className="va-note va-reach-note">
      {crossing.unplaced === 0 ? null : (
        <>
          {count(crossing.unplaced, 'subject')} could not be placed on either axis, because{' '}
          {crossing.unplaced === 1 ? 'its baseline records' : 'their baselines record'} no component
          list.{' '}
        </>
      )}
      {crossing.incomparable === 0 ? null : (
        <>
          {count(crossing.incomparable, 'subject')}{' '}
          {crossing.incomparable === 1 ? 'was' : 'were'} new or could not be compared, so there is
          no moved-or-still to cross.
        </>
      )}
    </p>
  );
}

/**
 * Where the attribution is knowingly wider than the diff.
 *
 * The list names its files rather than counting them, because each is something
 * an operator can go and fix, and a bare count tells them there is nothing to do.
 */
function Holes({ reach }: { readonly reach: ReachView }): ReactElement | null {
  if (reach.unscanned === undefined) return null;

  return (
    <p className="va-note va-reach-note">
      {count(reach.unscanned.length, 'changed file')} under the scanned roots{' '}
      {reach.unscanned.length === 1 ? 'is' : 'are'} not in the graph:{' '}
      <Files names={reach.unscanned} />.
    </p>
  );
}

/**
 * Which of a subject's own components the commit arrives at.
 *
 * `SubjectReach.through` holds component names, not paths, and they are set as
 * prose for that reason: a reader shown `MainNav` in the same monospace face as
 * `app/src/components/MainNav.tsx` reads the two as the same kind of thing and
 * starts looking for a file by that name.
 *
 * Nothing at all when the list is empty, rather than a dangling `via`. Empty here
 * is `reached: false`, which this list is not.
 */
function Via({ through }: { readonly through: readonly string[] }): ReactElement | null {
  if (through.length === 0) return null;

  return <span className="va-note">via {through.join(', ')}</span>;
}

function Files({ names }: { readonly names: readonly string[] }): ReactElement {
  return (
    <>
      {names.map((name, index) => (
        <span key={name}>
          {index === 0 ? null : ', '}
          <code>{name}</code>
        </span>
      ))}
    </>
  );
}

/**
 * What the record says about a subject nothing in this commit reaches.
 *
 * Read on mount rather than behind a button, which is the opposite of the
 * per-subject history elsewhere on this page and is deliberate. A reviewer who
 * has opened a subject has already decided it is worth their time; this list is
 * short by construction and every row on it is *already* the anomaly. "Has this
 * moved on its own before" is the entire reason the row is here, so waiting to be
 * asked it would be waiting to be asked the point.
 */
function Journey({
  client,
  subject,
}: {
  readonly client: ReviewClient;
  readonly subject: string;
}): ReactElement {
  const [answer, setAnswer] = useState<
    | { readonly state: 'reading' }
    | { readonly state: 'failed'; readonly why: string }
    | { readonly state: 'read'; readonly flakiness: Flakiness }
  >({ state: 'reading' });

  const load = useCallback(async (): Promise<void> => {
    try {
      setAnswer({ state: 'read', flakiness: await client.flakiness(subject) });
    } catch (error) {
      setAnswer({ state: 'failed', why: error instanceof Error ? error.message : String(error) });
    }
  }, [client, subject]);

  useEffect(() => {
    void load();
  }, [load]);

  if (answer.state === 'reading') return <p className="va-note">Reading the record…</p>;

  // A record that could not be read says so. Blank here reads as "nothing on
  // file", which is the one answer that would send a reviewer to approve an
  // otherwise unexplained change.
  if (answer.state === 'failed') {
    return <p className="va-note va-lost">The record could not be read: {answer.why}</p>;
  }

  return <StabilityLine flakiness={answer.flakiness} />;
}
