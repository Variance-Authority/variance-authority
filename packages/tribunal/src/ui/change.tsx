/**
 * One change, whole — the page a decision is actually made on.
 *
 * A change is a component and the renders it moved in, and until this page
 * existed all of that was a card in a stack of cards on a build page four
 * thousand pixels tall. The card carried a name, a file path, a ratio and a
 * fingerprint, which between them tell a reviewer nothing they can act on: the
 * hash is not a fact about the change, it is the *identity* of a fact, and it was
 * in the third line of the lead.
 *
 * What a reviewer needs, in the order they need it:
 *
 * 1. **What moved**, in renders rather than pixels. One edit in eleven places is
 *    a different afternoon from eleven edits in eleven places, and the pixel
 *    total cannot tell them apart.
 * 2. **Whether they asked for it.** The commit either arrives at this component
 *    or it does not, and *it does not, in a render nothing else reaches either*
 *    is the loudest sentence this product can print.
 * 3. **Whether they have seen it.** The run before this one either carried the
 *    same difference or did not, and if it did, somebody either decided it or
 *    left it. A docket delivered twice to a reviewer who read it once is the
 *    failure the crossing exists to name, and it is named *here*, beside the
 *    change — not in a panel nine thousand pixels below it.
 * 4. **Whether it is normal.** The same 2px shift is a bug in a component nobody
 *    has touched since March and a Tuesday in one that moves in nineteen runs out
 *    of twenty.
 * 5. **The picture**, cropped to where the run measured it.
 * 6. **Where it showed up**, one row per render, each decidable on its own.
 *
 * The two buttons are in the head, not at the bottom. Every line under them is a
 * reason to press one or to refuse; a reviewer who has read them should not have
 * to scroll back past the reasons to act on them.
 */

import { useState, type ReactElement } from 'react';
import type { BuildDetail, Decision } from '../review-types.js';
import {
  Arrival,
  Collateral,
  Declared,
  Recurrence,
  Shapes,
  SinceLast,
  Spread,
} from './change-story.js';
import { Because } from './because.js';
import type { ReviewClient } from './client.js';
import type { Crossing } from './crossing.js';
import { distanceFrom } from './distance.js';
import type { Appearance, Origin } from './grouping.js';
import { Look } from './look.js';
import { MovedElsewhere, MovedLead, WhatMoved } from './moved.js';
import { movedElsewhere, senseAcross } from './sense.js';
import { Go, messageOf } from './shell.js';
import type { Route } from './route.js';
import type { Shifted } from './shift.js';
import { count, number } from './text.js';

export function ChangePanel({
  client,
  reviewer,
  build,
  origin,
  crossing,
  changes,
  go,
  onDecided,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: BuildDetail;
  readonly origin: Origin;
  readonly crossing: Crossing;
  /** Every component with a change page on this build, so a link goes somewhere. */
  readonly changes: ReadonlySet<string>;
  readonly go: (route: Route) => void;
  readonly onDecided: () => void;
}): ReactElement {
  const sourced = build.causes.some((cause) => cause.file !== undefined);
  const across = senseAcross(origin.component, origin.appearances);
  const far = distanceFrom(build, origin.component);
  const elsewhere = movedElsewhere(
    origin.component,
    build.subjects,
    new Set(origin.appearances.map(({ subject }) => subject.subject)),
  );
  const settled = origin.appearances.filter(({ subject }) => subject.decision !== null).length;
  const open = origin.appearances.filter(
    ({ subject }) => subject.decision === null && subject.approvable,
  );

  return (
    <div className="va-stage va-scroll">
      <div className="va-page va-decide">
        <header className="va-decide-head">
          <div>
            <h1>{origin.component}</h1>
            <Declared file={origin.file} sourced={sourced} />
          </div>
          <Batch
            client={client}
            reviewer={reviewer}
            build={build.build}
            origin={origin}
            open={open}
            settled={settled}
            onDecided={onDecided}
          />
        </header>

        <p className="va-decide-lead">
          <MovedLead component={origin.component} across={across} />
          <Spread origin={origin} />
        </p>

        {/* Second, and before a word of prose: the differences themselves, one
            per shape. Everything under this is the page reasoning about a change
            the reviewer can now see, and a decision made without seeing it is the
            failure this whole surface exists to prevent. */}
        <Look
          client={client}
          build={build.build}
          component={origin.component}
          appearances={origin.appearances}
          onOpen={(subject) => go({ page: 'subject', build: build.build, subject })}
        />

        {/* Then why. A reviewer who has just read *what* moved and looked at it
            asks one question, and the two lines that answer it belong under the
            question rather than three sections down past the collateral. */}
        <Because origin={origin} build={build.build} changes={changes} go={go} />
        <Arrival origin={origin} />

        <WhatMoved component={origin.component} across={across} far={far} />
        <MovedElsewhere
          component={origin.component}
          found={elsewhere}
          build={build.build}
          go={go}
        />
        <SinceLast crossing={crossing} origin={origin} />
        <Recurrence client={client} component={origin.component} />
        <Shapes appearances={origin.appearances} />

        <h2>Where it showed up</h2>
        <ul className="va-where">
          {origin.appearances.map((appearance) => (
            <Where
              key={appearance.subject.subject}
              client={client}
              reviewer={reviewer}
              build={build.build}
              appearance={appearance}
              apart={
                appearance.movement !== undefined && appearance.movement.cause !== origin.cause
              }
              was={crossing.state === 'ready' ? crossing.of(appearance.subject.subject) : undefined}
              against={crossing.state === 'ready' ? crossing.earlier.build : undefined}
              go={go}
              onDecided={onDecided}
            />
          ))}
        </ul>

        <Collateral build={build} />
      </div>
    </div>
  );
}

/** One render this change showed up in, and the decision on that one render. */
function Where({
  client,
  reviewer,
  build,
  appearance,
  apart,
  was,
  against,
  go,
  onDecided,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: string;
  readonly appearance: Appearance;
  /** This render moved for a different reason than the change as a whole. */
  readonly apart: boolean;
  readonly was?: Shifted | undefined;
  readonly against?: string | undefined;
  readonly go: (route: Route) => void;
  readonly onDecided: () => void;
}): ReactElement {
  const { subject, pixels, alongside } = appearance;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | undefined>(undefined);

  const decide = async (decision: Decision): Promise<void> => {
    setBusy(true);
    setFailed(undefined);
    try {
      await client.decide(build, subject.subject, decision, reviewer);
      onDecided();
    } catch (error) {
      setFailed(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="va-where-row">
      <Go
        to={{ page: 'subject', build, subject: subject.subject }}
        go={go}
        className="va-where-subject"
      >
        {subject.subject}
      </Go>
      <span className="va-where-size va-num va-note">{number(pixels)} px</span>
      {apart && appearance.movement !== undefined ? (
        <span className="va-mark va-note" title={appearance.movement.because}>
          {appearance.movement.upstream === undefined
            ? appearance.movement.cause
            : `from ${appearance.movement.upstream}`}
        </span>
      ) : null}
      {was === undefined || was.shift !== 'again' ? null : (
        <span className="va-mark va-known">
          same as {against === undefined ? 'the last run' : `build ${against}`}
          {was.earlier?.decision == null ? ', undecided' : ''}
        </span>
      )}
      {alongside.length === 0 ? null : (
        <span className="va-where-with va-note" title={alongside.join(', ')}>
          alongside {alongside.slice(0, 3).join(', ')}
          {alongside.length > 3 ? ` and ${count(alongside.length - 3, 'other')}` : ''}
        </span>
      )}
      {subject.decision === null ? (
        <span className="va-where-act">
          <button
            type="button"
            className="va-approve"
            disabled={busy || !subject.approvable}
            onClick={() => void decide('approved')}
            title={
              subject.approvable
                ? 'Promote this render’s candidate, and no others'
                : 'This run kept no candidate image for this subject, so there is nothing to promote.'
            }
          >
            ✓
          </button>
          <button type="button" disabled={busy} onClick={() => void decide('rejected')}>
            ✕
          </button>
        </span>
      ) : (
        <span className={`va-mark va-${subject.decision.decision}`}>
          {subject.decision.decision === 'approved' ? '✓' : '✕'} {subject.decision.by}
        </span>
      )}
      {failed === undefined ? null : <span className="va-failure">{failed}</span>}
    </li>
  );
}

/**
 * One decision, applied to every render the change showed up in.
 *
 * The store keeps a row per subject and this does not change that: what is shared
 * is the *act*, not the record. A group decision as a stored entity would be a
 * second thing that can disagree with the rows under it, and the note is what
 * carries the reviewer's reason to each one.
 */
function Batch({
  client,
  reviewer,
  build,
  origin,
  open,
  settled,
  onDecided,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: string;
  readonly origin: Origin;
  readonly open: readonly Appearance[];
  readonly settled: number;
  readonly onDecided: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | undefined>(undefined);

  const blocked = origin.appearances.length - open.length - settled;

  const decide = async (decision: Decision): Promise<void> => {
    setBusy(true);
    setFailed(undefined);
    try {
      for (const { subject } of open) {
        await client.decide(
          build,
          subject.subject,
          decision,
          reviewer,
          `${decision} as one change in ${origin.component}`,
        );
      }
      onDecided();
    } catch (error) {
      // Reported rather than swallowed, and the ones already written stay
      // written: a batch that rolled itself back would undo decisions a reviewer
      // made, to tidy up a network error.
      setFailed(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="va-decide-act">
      <button
        type="button"
        className="va-approve"
        disabled={busy || open.length === 0}
        onClick={() => void decide('approved')}
        title={`Promote the candidate in every render ${origin.component} moved`}
      >
        Approve this change{open.length === 0 ? '' : ` (${number(open.length)})`}
      </button>
      <button
        type="button"
        disabled={busy || open.length === 0}
        onClick={() => void decide('rejected')}
      >
        Reject
      </button>
      {settled === 0 ? null : <span className="va-note">{number(settled)} already decided</span>}
      {blocked === 0 ? null : (
        <span className="va-note">
          {count(blocked, 'render')} kept no candidate and cannot be approved here
        </span>
      )}
      {failed === undefined ? null : <p className="va-failure">{failed}</p>}
    </div>
  );
}
