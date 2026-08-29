/**
 * The changes, grouped by what caused them — which is the unit a reviewer acts on.
 *
 * Nobody approves a screenshot. A person looking at twenty changed renders is
 * looking at *one* edit to `Button` twenty times, and the category ships that as
 * twenty decisions: twenty thumbnails, twenty approve buttons, and no way to say
 * the thing that is actually true — *yes, I meant to restyle the button, and yes,
 * every card that grew by two millimetres grew because of it.*
 *
 * So the review item here is the origin, and a subject is a place it showed up.
 *
 * ## Three records meet on one card, and none of them can carry it alone
 *
 * - **The diff** says the commit reaches this component, and by what chain. An
 *   origin the commit does not reach is the strongest signal on the page: nothing
 *   you wrote arrives here and it moved anyway.
 * - **The fingerprint** says whether they moved *the same way* — the shape with
 *   position and values removed. It does not decide the group and must not: a
 *   shape is a pixel digest, so one restyle lands as one shape on the buttons
 *   that are the same size and another on the one that is not. It answers the
 *   question after the group, which is which of these differences recur — and a
 *   shared shape is the set `variance accept --shape` takes.
 * - **The record** says whether this component moves all the time or has been
 *   still since March. A 2px shift in a component that has caused an approved
 *   change in nineteen of twenty runs is a different decision from the same 2px in
 *   one that has caused none.
 *
 * ## What is not claimed
 *
 * Collateral is **not** attributed to an origin. Deciding which edit pushed which
 * box around is exactly the attribution the semantic tier declined to make, and a
 * group that swallowed it would be inventing the one number nobody measured. What
 * a member carries instead is the list of components that moved *with* it in that
 * subject, which is an observation rather than a claim.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Churn } from '@variance-authority/history';
import type { BuildDetail, Decision, SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { ChurnLine } from './history.js';
import { leadOf } from './lead.js';
import { count, magnitude, number } from './text.js';

/** One subject an origin showed up in. */
export interface Appearance {
  readonly subject: SubjectView;
  /** Pixels the origin's own cause region moved here. */
  readonly pixels: number;
  /** The shape of that region, when the run recorded one. */
  readonly shape?: string;
  /** Other components with regions in this subject — observed, not attributed. */
  readonly alongside: readonly string[];
}

export interface Origin {
  readonly component: string;
  /** Where the component is declared, from the build's own docket. */
  readonly file?: string;
  readonly pixels: number;
  readonly appearances: readonly Appearance[];
  /** How the commit arrives at this component, when a diff was read. */
  readonly trail?: readonly string[];
  /** `undefined` when the run carried no diff, which is not the same as `false`. */
  readonly reached?: boolean;
}

export interface Origins {
  readonly origins: readonly Origin[];
  /**
   * Changed subjects no component claimed.
   *
   * Their own bucket, never folded into an origin. A subject that moved with
   * nothing named as its cause is the one case where a reviewer has to open the
   * picture, and hiding it inside a group would hand them somebody else's edit to
   * approve it under.
   */
  readonly unattributed: readonly SubjectView[];
}


export function originsOf(build: BuildDetail): Origins {
  const files = new Map(build.causes.map((cause) => [cause.component, cause.file]));
  const groups = new Map<string, { pixels: number; where: Appearance[] }>();
  const unattributed: SubjectView[] = [];

  for (const subject of build.subjects) {
    if (subject.verdict !== 'changed') continue;

    const lead = leadOf(subject);
    if (lead?.component === undefined) {
      unattributed.push(subject);
      continue;
    }

    const group = groups.get(lead.component) ?? { pixels: 0, where: [] };
    group.pixels += lead.pixels;
    group.where.push({
      subject,
      pixels: lead.pixels,
      ...(lead.fingerprint === undefined ? {} : { shape: lead.fingerprint }),
      alongside: [
        ...new Set(
          subject.regions
            .map((region) => region.component)
            .filter((name): name is string => name !== undefined && name !== lead.component),
        ),
      ].sort(),
    });
    groups.set(lead.component, group);
  }

  const origins = [...groups.entries()]
    .map(([component, group]): Origin => {
      const file = files.get(component);
      const entry = build.reach?.components.find((each) => each.component === component);
      return {
        component,
        pixels: group.pixels,
        appearances: group.where,
        ...(file === undefined ? {} : { file }),
        ...(build.reach === null || build.reach.whole !== undefined
          ? {}
          : { reached: entry !== undefined }),
        ...(entry === undefined ? {} : { trail: entry.trail }),
      };
    })
    .sort((left, right) =>
      right.pixels === left.pixels
        ? left.component.localeCompare(right.component)
        : right.pixels - left.pixels,
    );

  return { origins, unattributed };
}

export function OriginsPanel({
  client,
  reviewer,
  build,
  onDecided,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: BuildDetail;
  readonly onDecided: () => void;
}): ReactElement {
  const { origins, unattributed } = originsOf(build);
  const subjects = origins.reduce((total, origin) => total + origin.appearances.length, 0);

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
            onDecided={onDecided}
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
                <strong>{subject.subject}</strong>{' '}
                <span className="va-note">{magnitude(subject)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function OriginCard({
  client,
  reviewer,
  build,
  origin,
  onDecided,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: string;
  readonly origin: Origin;
  readonly onDecided: () => void;
}): ReactElement {
  const settled = origin.appearances.filter(({ subject }) => subject.decision !== null).length;
  const open = origin.appearances.filter(
    ({ subject }) => subject.decision === null && subject.approvable,
  );

  return (
    <section className="va-origin">
      <div className="va-origin-head">
        <h3>{origin.component}</h3>
        {origin.file === undefined ? null : <code className="va-file">{origin.file}</code>}
        <span className="va-origin-pixels va-num">{scale(origin.appearances)}</span>
      </div>

      <Arrival origin={origin} />
      <Shapes appearances={origin.appearances} />
      <Record client={client} component={origin.component} />

      <ul className="va-origin-where">
        {origin.appearances.map(({ subject, pixels, alongside }) => (
          <li key={subject.subject}>
            <span className="va-origin-subject">{subject.subject}</span>
            <span className="va-num va-note">{number(pixels)} px</span>
            {alongside.length === 0 ? null : (
              <span className="va-note">
                moved alongside {alongside.slice(0, 3).join(', ')}
                {alongside.length > 3 ? ` and ${count(alongside.length - 3, 'other')}` : ''}
              </span>
            )}
            {subject.decision === null ? null : (
              <span className={subject.decision.decision === 'approved' ? 'va-mark va-approved' : 'va-mark va-rejected'}>
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
 * Whether the commit arrives here, said in three states rather than two.
 *
 * A run with no diff read cannot say, and saying nothing is the only honest
 * version of that. Silence would be indistinguishable from *reached*, which is
 * the assumption a reviewer makes by default and the one that costs them.
 */
function Arrival({ origin }: { readonly origin: Origin }): ReactElement | null {
  if (origin.reached === undefined) return null;

  if (!origin.reached) {
    return (
      <p className="va-origin-arrival va-alarm">
        Nothing in this commit reaches <strong>{origin.component}</strong>, and it caused a change
        anyway.
      </p>
    );
  }

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

/**
 * What the differences look like, which is the half a component name cannot say.
 *
 * A component groups *what was edited*. A shape groups *what the edit did*, and
 * the two answer different questions: eleven appearances under `Button` with one
 * shape between them is a token that moved every button identically, and eleven
 * with nine shapes is a component whose renders each absorbed the change
 * differently. Both are one review. Only the first has a name a reviewer can
 * carry to another build.
 *
 * So the shared shape is reported where there is one, and where the reviewer's
 * next question is *which of these recur*, the largest cluster is named with the
 * digest `variance accept --shape` takes.
 */
function shapesOf(appearances: readonly Appearance[]): Map<string, number> {
  const clusters = new Map<string, number>();
  for (const each of appearances) {
    if (each.shape === undefined) continue;
    clusters.set(each.shape, (clusters.get(each.shape) ?? 0) + 1);
  }
  return clusters;
}

/**
 * How large this change is, counted in what is being decided.
 *
 * A pixel total is the figure this category leads with and the least useful one
 * available: it is one number for every size of change, and on the restyle that
 * moves everything it degenerates to a number nobody can act on. Distinct shapes
 * over the places they landed says the thing the total cannot — *one edit, seven
 * renders* is a different afternoon from *seven edits, seven renders*.
 */
function scale(appearances: readonly Appearance[]): string {
  const shapes = shapesOf(appearances).size;
  const pixels = appearances.reduce((total, each) => total + each.pixels, 0);
  const places = `${count(appearances.length, 'region')} · ${number(pixels)} px`;

  return shapes === 0 ? places : `${count(shapes, 'change')} · ${places}`;
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
        await client.decide(build, subject.subject, decision, reviewer, `${decision} as one change in ${origin.component}`);
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
