import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Churn, Flakiness, Reach } from '@variance-authority/history';
import type { ChangelogChange, ChangelogRow, SubjectView, TribunalChangelog } from '../review.js';
import type { ReviewClient } from './client.js';

/**
 * The two surfaces that read the record rather than the run.
 *
 * A build page answers *what changed here*. Everything in this file answers the
 * question a reviewer actually has to settle before approving: **is this
 * normal?** A 2px shift in a component that has moved in nineteen of the last
 * twenty runs is a different decision from the same 2px in a component nobody has
 * touched since March, and the two are indistinguishable in a before-and-after.
 *
 * ## The changelog is grouped by shape, not listed by approval
 *
 * One token change lands in three hundred subjects, and a list of three hundred
 * approvals is a list nobody reads to the end. So rows are clustered by the
 * fingerprints frozen into them: one entry, the component that owns it, and the
 * subjects it reached. What could not be grouped is *counted and shown* rather
 * than dropped — a changelog covering eleven of forty approvals that looks like a
 * changelog of eleven approvals is worse than no changelog.
 *
 * ## Absent numbers stay absent
 *
 * `Flakiness.rate` is missing when no run has read every subject twice, and it is
 * rendered as missing. Drawing `0%` there answers *how often does this flake*
 * with a confident number derived from a denominator nobody asked for, which is
 * the failure this project is arranged around.
 */

export function ChangelogPage({
  client,
  onBack,
}: {
  readonly client: ReviewClient;
  readonly onBack: () => void;
}): ReactElement {
  const [component, setComponent] = useState('');
  const [applied, setApplied] = useState('');
  const [log, setLog] = useState<
    { readonly state: 'loading' } | { readonly state: 'failed'; readonly why: string } | {
      readonly state: 'ready';
      readonly value: TribunalChangelog;
    }
  >({ state: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    setLog({ state: 'loading' });
    try {
      setLog({
        state: 'ready',
        value: await client.changelog(applied === '' ? {} : { component: applied }),
      });
    } catch (error) {
      setLog({ state: 'failed', why: messageOf(error) });
    }
  }, [client, applied]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <article className="va-changelog">
      <button type="button" className="va-back" onClick={onBack}>
        ← all builds
      </button>
      <h1>Changelog</h1>
      <p className="va-subtitle">
        Why the baselines are what they are: every approval, grouped by the shape that was approved.
      </p>

      <form
        className="va-filter"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(component.trim());
        }}
      >
        <label htmlFor="va-changelog-component">component</label>
        <input
          id="va-changelog-component"
          value={component}
          placeholder="any component"
          onChange={(event) => setComponent(event.target.value)}
        />
        <button type="submit">Filter</button>
        {applied === '' ? null : (
          <button
            type="button"
            onClick={() => {
              setComponent('');
              setApplied('');
            }}
          >
            Clear
          </button>
        )}
      </form>

      {log.state === 'loading' ? <p className="va-note">Loading the changelog…</p> : null}
      {log.state === 'failed' ? <Failure why={log.why} retry={load} /> : null}
      {log.state === 'ready' ? (
        <ChangelogEntries log={log.value} {...(applied === '' ? {} : { filter: applied })} />
      ) : null}
    </article>
  );
}

/**
 * The grouped changes, and the approvals no shape could group.
 *
 * The second list is not a footnote. The ephemeral and raster-only paths attribute
 * nothing and still approve something, and a reader who cannot see that a third of
 * the entries are unattributed will read the attributed two thirds as the whole.
 */
export function ChangelogEntries({
  log,
  filter,
}: {
  readonly log: TribunalChangelog;
  /** The component filter in force, so an empty answer can say which one emptied it. */
  readonly filter?: string;
}): ReactElement {
  if (log.changes.length === 0 && log.ungrouped.length === 0) {
    // Two sentences, because a filtered empty answer and an empty project are
    // different facts and only one of them is about the project. Told the first
    // as the second, a reviewer concludes nothing has ever been approved here.
    return (
      <p className="va-note">
        {filter === undefined
          ? 'Nothing has been approved in this project yet.'
          : `No approval matched “${filter}”. The project may still have approvals under other components.`}
      </p>
    );
  }

  return (
    <>
      <ol className="va-changes">
        {log.changes.map((change) => (
          <ChangeEntry key={change.fingerprint} change={change} />
        ))}
      </ol>

      {log.ungrouped.length === 0 ? null : (
        <section className="va-ungrouped">
          <h2>{log.ungrouped.length} approved without an attributed shape</h2>
          <p className="va-note">
            These runs kept no region attribution — an ephemeral or raster-only path — so nothing
            names what changed in them. Listed rather than dropped: they are approvals, and a total
            that omits them is not a total.
          </p>
          <ul>
            {log.ungrouped.map((row: ChangelogRow) => (
              <li key={`${row.build}/${row.subject}`}>
                <strong>{row.subject}</strong> — {row.by} · <code>{row.commit.slice(0, 8)}</code> ·{' '}
                {row.at}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ChangeEntry({ change }: { readonly change: ChangelogChange }): ReactElement {
  return (
    <li className="va-change">
      <h3>
        {change.component ?? 'an unnamed component'}
        {change.file === undefined ? null : (
          <>
            {' '}
            <code>{change.file}</code>
          </>
        )}
      </h3>
      <p className="va-change-meta">
        {change.subjects.length} subject{change.subjects.length === 1 ? '' : 's'} ·{' '}
        {change.builds.length} build{change.builds.length === 1 ? '' : 's'} · approved by{' '}
        {change.by.join(', ')} · {change.at}
      </p>
      {change.intent === undefined ? null : (
        <p className="va-intent">
          Declared intent: <em>{change.intent}</em>
        </p>
      )}
      {change.note === undefined ? null : <p className="va-change-note">{change.note}</p>}
      <details>
        <summary>subjects</summary>
        <ul className="va-change-subjects">
          {change.subjects.map((subject) => (
            <li key={subject}>{subject}</li>
          ))}
        </ul>
      </details>
      <p className="va-fingerprint">
        shape <code>{change.fingerprint.slice(0, 12)}</code> — the identity the grouping is computed
        from, so a shape approved across three sessions reads as one change.
      </p>
    </li>
  );
}

/**
 * What the record already knows about the subject in front of the reviewer.
 *
 * Fetched when the panel is opened rather than with the build, and per subject
 * rather than for all of them: a build with three hundred changed subjects would
 * otherwise make nine hundred history requests to draw a page on which a reviewer
 * reads one. The cost of the deferral is a click; the cost of not deferring is the
 * page.
 *
 * The component asked about is the subject's *cause* — the one the semantic tier
 * named — because churn and reach are questions about a component and the region
 * ranked first by area is the container that reflowed.
 */
export function SubjectHistory({
  client,
  subject,
}: {
  readonly client: ReviewClient;
  readonly subject: SubjectView;
}): ReactElement {
  const component = causeOf(subject);
  const [asked, setAsked] = useState(false);
  const [answer, setAnswer] = useState<
    | { readonly state: 'loading' }
    | { readonly state: 'failed'; readonly why: string }
    | {
        readonly state: 'ready';
        readonly flakiness: Flakiness;
        readonly churn?: Churn;
        readonly reach?: Reach;
      }
  >({ state: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    setAnswer({ state: 'loading' });
    try {
      const [flakiness, churn, reach] = await Promise.all([
        client.flakiness(subject.subject),
        component === undefined ? undefined : client.churn(component),
        component === undefined ? undefined : client.reach(component),
      ]);
      setAnswer({
        state: 'ready',
        flakiness,
        ...(churn === undefined ? {} : { churn }),
        ...(reach === undefined ? {} : { reach }),
      });
    } catch (error) {
      setAnswer({ state: 'failed', why: messageOf(error) });
    }
  }, [client, subject.subject, component]);

  useEffect(() => {
    if (asked) void load();
  }, [asked, load]);

  if (!asked) {
    return (
      <p className="va-history">
        <button type="button" className="va-ask" onClick={() => setAsked(true)}>
          Has this changed before?
        </button>
      </p>
    );
  }

  if (answer.state === 'loading') return <p className="va-note">Reading the record…</p>;
  if (answer.state === 'failed') return <Failure why={answer.why} retry={load} />;

  return (
    <section className="va-history">
      <StabilityLine flakiness={answer.flakiness} />
      {answer.churn === undefined || component === undefined ? (
        <p className="va-note">
          No component was named as the cause of this difference, so there is nothing to ask the
          record about. The regions came from a run that attributed nothing.
        </p>
      ) : (
        <ChurnLine
          component={component}
          churn={answer.churn}
          {...(answer.reach === undefined ? {} : { reach: answer.reach })}
        />
      )}
    </section>
  );
}

/**
 * How often this subject has failed to read the same way twice.
 *
 * Two numbers and never one. "Unstable in 6 of 20" and "6 times, none in the last
 * 9 sweeps" are opposite instructions to the person reading them, and only the
 * pair distinguishes a live flake from one somebody already fixed.
 */
export function StabilityLine({ flakiness }: { readonly flakiness: Flakiness }): ReactElement {
  if (flakiness.sweeps === 0) {
    return (
      <p className="va-stability va-unknown">
        Nothing has read this subject twice in the recorded window, so how stable it is is unknown —
        not stable. A rate needs a run that swept.
      </p>
    );
  }

  if (flakiness.occurrences === 0) {
    return (
      <p className="va-stability">
        Read twice in {flakiness.sweeps} run{flakiness.sweeps === 1 ? '' : 's'} and never disagreed
        with itself.
      </p>
    );
  }

  return (
    <p className="va-stability va-flaky">
      Read differently in {flakiness.occurrences} of {flakiness.sweeps} sweeps
      {flakiness.rate === undefined ? null : <> ({Math.round(flakiness.rate * 100)}%)</>}
      {flakiness.sweepsSince === 0
        ? ', most recently in the latest sweep'
        : `, none in the last ${flakiness.sweepsSince} sweep${flakiness.sweepsSince === 1 ? '' : 's'}`}
      .
      {flakiness.causes.length === 0 ? null : (
        <>
          {' '}
          Loudest cause: <strong>{flakiness.causes[0]?.component ?? 'unnamed'}</strong>
          {flakiness.causes[0]?.band === undefined ? null : <> ({flakiness.causes[0].band})</>}.
        </>
      )}
      {flakiness.absorbedRuns === 0 ? null : (
        <> {flakiness.absorbedRuns} further run(s) moved only in bands this subject declared it does not assert on.</>
      )}
    </p>
  );
}

/**
 * How often the cause has changed, and how far it reaches.
 *
 * `changedRuns` counts runs in which this component caused an **approved** change,
 * which is why the approvals route exists: without it every component in the
 * project reads as having never changed. Collateral is reported beside it and never
 * added to it — a component displaced by somebody else's edit is not a component
 * that keeps changing, and summing the two makes the widest container in the
 * application the most volatile thing in it, forever.
 */
export function ChurnLine({
  component,
  churn,
  reach,
}: {
  readonly component: string;
  readonly churn: Churn;
  readonly reach?: Reach;
}): ReactElement {
  return (
    <p className="va-churn">
      <strong>{component}</strong> caused an approved change in {churn.changedRuns} of {churn.runs}{' '}
      recorded run{churn.runs === 1 ? '' : 's'}
      {churn.lastAt === undefined ? null : <>, most recently {churn.lastAt}</>}.
      {churn.collateralRuns === 0 ? null : (
        <> It was displaced without changing in {churn.collateralRuns} more.</>
      )}
      {churn.rejectedRuns === 0 ? null : <> {churn.rejectedRuns} change to it was rejected.</>}
      {reach === undefined ? null : (
        <>
          {' '}
          It is observed in {reach.subjects.length} subject
          {reach.subjects.length === 1 ? '' : 's'}
          {reach.arrived.length === 0 ? null : <>, having arrived in {reach.arrived.length} of them in this window</>}
          .
        </>
      )}
    </p>
  );
}

/**
 * The component the tier named as this subject's cause.
 *
 * The first region marked `cause`, in the order the report gave, and never the
 * largest: ranking by area reports the container that reflowed instead of the edit
 * that moved it, measured at 6× on one change. Absent when the run attributed
 * nothing, and absent is rendered rather than replaced with a guess.
 */
function causeOf(subject: SubjectView): string | undefined {
  return subject.regions.find((region) => region.cause === true)?.component;
}

function Failure({ why, retry }: { readonly why: string; readonly retry: () => void }): ReactElement {
  return (
    <p className="va-failure">
      {why}{' '}
      <button type="button" onClick={retry}>
        retry
      </button>
    </p>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
