/**
 * The changes, drawn: one card per origin, and the decision on it.
 *
 * What a change *is* — which subjects belong to it, what the diff says about it,
 * what shape it repeats in — is decided in [`grouping.ts`](./grouping.ts) and
 * only read here. This file is the card: what the reviewer is told, in what
 * order, and which of it they can act on without leaving.
 *
 * The order is the argument. A card opens with the component, says whether the
 * commit arrives there, says whether the differences under it look alike, offers
 * the change to be looked at, and only then offers the two buttons. Every line
 * above the buttons is a reason to press one of them or to refuse — a surface
 * that led with the buttons would be a faster way to approve things nobody read.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Churn } from '@variance-authority/history';
import type { BuildDetail, Decision } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { originsOf, scale, shapesOf, type Appearance, type Origin } from './grouping.js';
import { ChurnLine } from './history.js';
import { Look } from './look.js';
import { count, magnitude, number } from './text.js';

export function OriginsPanel({
  client,
  reviewer,
  build,
  onDecided,
  onOpen,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: BuildDetail;
  readonly onDecided: () => void;
  /**
   * Show one render whole.
   *
   * Optional, and the card degrades to text without it: the panel is exported,
   * and a caller embedding it outside this page has no stage to open into. What
   * it must never do is render a control that goes nowhere.
   */
  readonly onOpen?: ((subject: string) => void) | undefined;
}): ReactElement {
  const { origins, unattributed } = originsOf(build);
  const subjects = origins.reduce((total, origin) => total + origin.appearances.length, 0);
  const sourced = build.causes.some((cause) => cause.file !== undefined);

  if (origins.length === 0 && unattributed.length === 0) {
    return <p className="va-note">Nothing in this build changed, so there is nothing to approve.</p>;
  }

  return (
    <>
      <h2>The changes</h2>
      <p className="va-subtitle">
        {count(origins.length, 'change')} across {count(subjects, 'subject')}. The decision is the
        change; the subjects are where it showed up.
      </p>
      <p className="va-collateral">
        {count(build.causes[0]?.collateralPixels ?? 0, 'collateral pixel')} moved with them —
        regions that shifted because something else did. Counted, not split between the changes:
        deciding which edit pushed which box around is the one attribution nothing here measured.
      </p>

      <div className="va-origins">
        {origins.map((origin) => (
          <OriginCard
            key={origin.component}
            client={client}
            reviewer={reviewer}
            build={build.build}
            origin={origin}
            sourced={sourced}
            onDecided={onDecided}
            onOpen={onOpen}
          />
        ))}
      </div>

      {unattributed.length === 0 ? null : (
        <section className="va-origin va-orphan">
          <h3>Moved with nothing named as the cause</h3>
          <p className="va-note">
            No component claimed these, so there is no change to approve them under. They are the
            renders that have to be opened.
          </p>
          <ul className="va-reach-list">
            {unattributed.map((subject) => (
              <li key={subject.subject}>
                <Named subject={subject.subject} onOpen={onOpen} />{' '}
                <span className="va-note">{magnitude(subject)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** A subject's name, and the way in when there is one. */
function Named({
  subject,
  onOpen,
}: {
  readonly subject: string;
  readonly onOpen?: ((subject: string) => void) | undefined;
}): ReactElement {
  if (onOpen === undefined) return <strong>{subject}</strong>;

  return (
    <button type="button" className="va-open" onClick={() => onOpen(subject)}>
      {subject}
    </button>
  );
}

function OriginCard({
  client,
  reviewer,
  build,
  origin,
  sourced,
  onDecided,
  onOpen,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: string;
  readonly origin: Origin;
  readonly sourced: boolean;
  readonly onDecided: () => void;
  readonly onOpen?: ((subject: string) => void) | undefined;
}): ReactElement {
  const settled = origin.appearances.filter(({ subject }) => subject.decision !== null).length;
  const open = origin.appearances.filter(
    ({ subject }) => subject.decision === null && subject.approvable,
  );

  return (
    <section className="va-origin">
      <div className="va-origin-head">
        <h3>{origin.component}</h3>
        <Declared file={origin.file} sourced={sourced} />
        <span className="va-origin-pixels va-num">{scale(origin.appearances)}</span>
      </div>

      <Arrival origin={origin} />
      <Shapes appearances={origin.appearances} />
      <Record client={client} component={origin.component} />

      <Look
        client={client}
        build={build}
        component={origin.component}
        appearances={origin.appearances}
        onOpen={onOpen}
      />

      <ul className="va-origin-where">
        {origin.appearances.map(({ subject, pixels, alongside }) => (
          <li key={subject.subject}>
            <span className="va-origin-subject">
              <Named subject={subject.subject} onOpen={onOpen} />
            </span>
            <span className="va-num va-note">{number(pixels)} px</span>
            {alongside.length === 0 ? null : (
              <span className="va-note">
                moved alongside {alongside.slice(0, 3).join(', ')}
                {alongside.length > 3 ? ` and ${count(alongside.length - 3, 'other')}` : ''}
              </span>
            )}
            {subject.decision === null ? null : (
              <span
                className={
                  subject.decision.decision === 'approved'
                    ? 'va-mark va-approved'
                    : 'va-mark va-rejected'
                }
              >
                {subject.decision.decision === 'approved' ? '✓' : '✕'}
              </span>
            )}
          </li>
        ))}
      </ul>

      <Batch
        client={client}
        reviewer={reviewer}
        build={build}
        origin={origin}
        open={open}
        settled={settled}
        onDecided={onDecided}
      />
    </section>
  );
}

/**
 * Where this component is declared, and what it means when nothing says.
 *
 * A blank is the one answer this cell must not give. The reviewer's next move on
 * an origin they do not recognise is to open the file, and *nothing here* reads
 * as a defect in the tool — when the ordinary cause is that the name belongs to a
 * dependency, which the source index scans no part of and never claimed to. So
 * the two silences are separated: a run that resolved files for other components
 * has said something about this one, and a run that resolved none has not.
 */
function Declared({
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
 * Whether the commit arrives here, said in four states rather than two.
 *
 * A run with no diff read cannot say, and saying nothing is the only honest
 * version of that. Silence would be indistinguishable from *reached*, which is
 * the assumption a reviewer makes by default and the one that costs them.
 *
 * The other three are the split this card got wrong. `reached` is computed
 * against the components the diff can arrive at, so a component the graph carries
 * nowhere — anything out of `node_modules`, which is most of the host nodes on a
 * real page — can never be in that set whatever the commit did. Printing *nothing
 * reaches it and it moved anyway* over every one of those spends the loudest
 * sentence on the page on the most ordinary fact about it, and by the time a real
 * orphan appears the sentence has been trained out of the reader.
 *
 * So the renders are asked as well as the name. A component the diff does not
 * know, moving in renders the diff reaches through three components it does, is a
 * note. A component moving in a render the commit reaches *nothing* in is the
 * alarm, and it is now the only thing wearing that colour.
 */
function Arrival({ origin }: { readonly origin: Origin }): ReactElement | null {
  if (origin.reached === undefined) return null;

  if (origin.reached) {
    return (
      <p className="va-origin-arrival">
        {origin.trail === undefined
          ? 'This commit reaches it.'
          : origin.trail.map((step, index) => (
              <span key={step}>
                {index === 0 ? null : <span className="va-arrow">→</span>}
                {index === origin.trail!.length - 1 ? <strong>{step}</strong> : <code>{step}</code>}
              </span>
            ))}
      </p>
    );
  }

  const stranded = origin.stranded ?? [];
  const through = origin.through ?? [];

  if (stranded.length > 0) {
    return (
      <p className="va-origin-arrival va-alarm">
        This commit reaches nothing at all in {count(stranded.length, 'render')} it moved in —{' '}
        {stranded.slice(0, 3).join(', ')}
        {stranded.length > 3 ? `, and ${count(stranded.length - 3, 'other')}` : ''}. Something
        changed there that the diff cannot account for.
      </p>
    );
  }

  return (
    <p className="va-origin-arrival va-unnamed">
      The commit reaches nothing called <strong>{origin.component}</strong> — the file graph carries
      no such name, which is what a component out of a dependency looks like from here.{' '}
      {through.length === 0
        ? 'It does reach every render this moved in, without naming a component in any of them.'
        : `It does reach every render this moved in, through ${through.slice(0, 4).join(', ')}${
            through.length > 4 ? ` and ${count(through.length - 4, 'other')}` : ''
          } — so either one of those drew this node, or something reaches it that the graph does not model.`}
    </p>
  );
}

function Shapes({ appearances }: { readonly appearances: readonly Appearance[] }): ReactElement {
  const clusters = shapesOf(appearances);

  if (clusters.size === 0) {
    return (
      <p className="va-note">
        The run recorded no shape for these differences, so nothing here says the{' '}
        {count(appearances.length, 'appearance')} look alike — only that one component caused them.
      </p>
    );
  }

  const [shape, largest] = [...clusters.entries()].sort((left, right) => right[1] - left[1])[0]!;

  if (clusters.size === 1 && largest === appearances.length) {
    return (
      <p className="va-note">
        The same difference in every one of them — shape <code>{shape}</code>, which is what{' '}
        <code>variance accept --shape</code> takes.
      </p>
    );
  }

  return (
    <p className="va-note">
      The largest, <code>{shape}</code>, is {number(largest)} of the{' '}
      {count(appearances.length, 'appearance')}. One component absorbing a change several ways is
      ordinary — the shapes are which of them recur.
    </p>
  );
}

/** The record for this component, asked on mount: there are few origins by design. */
function Record({
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
      // A missing record is a silence this card can afford. Everything above it
      // is a reading of this build, and none of it becomes less true because the
      // history service did not answer.
      setChurn(null);
    }
  }, [client, component]);

  useEffect(() => {
    void load();
  }, [load]);

  // `0 of 0 runs` on every card is the shape of an answer with none of the
  // substance, and this card is a reading of *this* build — history is an
  // addition where there is history, not a line that has to be filled.
  if (churn === null || churn.runs === 0) return null;

  return <ChurnLine component={component} churn={churn} />;
}

/**
 * One decision, applied to every subject the change showed up in.
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
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="va-origin-act">
      <button
        type="button"
        className="va-approve"
        disabled={busy || open.length === 0}
        onClick={() => void decide('approved')}
        title={`Promote the candidate in every subject ${origin.component} moved`}
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
          {count(blocked, 'subject')} kept no candidate and cannot be approved here
        </span>
      )}
      {failed === undefined ? null : <p className="va-failure">{failed}</p>}
    </div>
  );
}
