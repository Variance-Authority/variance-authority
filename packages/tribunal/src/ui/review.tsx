import type { VariationRecord } from '@variance-authority/report';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { BuildDetail, BuildSummary, Cause, Decision, SubjectView } from '../review.js';
import type { ReviewClient } from './client.js';
import { ChangelogPage, SubjectHistory } from './history.js';
import { Viewer } from './viewer.js';

/**
 * The review surface, as ordinary React.
 *
 * No framework imports, no router, no data-fetching library, no CSS toolchain —
 * so it mounts inside whatever the operator already deploys. `./next` is one
 * such wiring, for a [vinext](https://vinext.io) app; a Vite SPA needs nothing
 * from this package but these components and `createReviewClient`.
 *
 * ## What this surface is *for*, which is not "looking at two screenshots"
 *
 * Every hosted product in this category shows you a before and an after and asks
 * you to spot the difference. That is the review blindness the whole project
 * exists to refuse: the hundredth screenshot in a run gets the same glance as the
 * first, and the three-hundred-and-first is approved without being read.
 *
 * So the ordering here is deliberate and is the opposite of the category's:
 *
 * 1. **The docket first.** Components named as *causes*, largest cause first,
 *    with collateral counted rather than listed. One token change across 300
 *    subjects is one item with a count.
 * 2. **The regions on the image.** A reviewer sees which box moved and which
 *    component owns it, drawn over the render, cause and collateral distinct.
 * 3. **The image last**, and only then as a comparison.
 *
 * Ranked by area a report of this kind is *wrong* — a container that was never
 * edited and only reflowed outranks the edit, measured at 6× on one change. The
 * ordering below comes from the tier that has provenance, which is why `cause`
 * is a field on a region rather than a guess made here.
 *
 * Step 2 and step 3 live in [`viewer.tsx`](./viewer.tsx) and are re-exported
 * below: a component that moved file has not moved API, and `./ui` names these.
 *
 * ## Beside the docket: what the run read that has no baseline in it
 *
 * A docket answers *what changed since last time*. It cannot answer *does this
 * flag do anything* — a subject added behind one is `new`, its diff is empty, and
 * the flag's effect is visible only by opening two pictures side by side, which
 * is the comparison nobody performs. The run already made it, against the subject
 * this one declares itself a variation of, so `Variations` prints the answer
 * rather than leaving it in the file. It is not a verdict and is never counted as
 * one: a variation is a difference somebody meant.
 *
 * ## 4. And then the record, because "is this normal?" is the real question
 *
 * A difference is not a decision. The same 2px shift is a bug in a component
 * nobody has touched since March and a Tuesday in one that moves in nineteen runs
 * out of twenty, and a before-and-after cannot tell those apart. So the surface
 * reaches the same history the CLI writes — churn, reach, stability, and the
 * changelog of what was approved before — from [`history.tsx`](./history.tsx),
 * one subject at a time and only when asked.
 */

export { RegionOverlay, Viewer, modesFor, type ViewerMode } from './viewer.js';
export { ChangelogEntries, ChangelogPage, ChurnLine, StabilityLine, SubjectHistory } from './history.js';

export interface ReviewAppProps {
  readonly client: ReviewClient;
  /** Recorded on every decision. There are no accounts here; this is a name. */
  readonly reviewer: string;
  /** How many builds to list. The server's own default applies when absent. */
  readonly limit?: number;
}

type Loaded<T> = { readonly state: 'loading' } | { readonly state: 'failed'; readonly why: string } | {
  readonly state: 'ready';
  readonly value: T;
};

/**
 * The docket, a build, and one subject at a time — the surface, mounted whole.
 *
 * Give it a client and the reviewer's name and it is the entire review
 * experience: builds awaiting decision, causes ranked, regions drawn, and the
 * approve and reject that write back. It holds no credential of its own, which
 * is why the name is a prop and not something it asks the server for.
 */
export function ReviewApp({ client, reviewer, limit }: ReviewAppProps): ReactElement {
  const [builds, setBuilds] = useState<Loaded<readonly BuildSummary[]>>({ state: 'loading' });
  const [open, setOpen] = useState<string | null>(null);
  const [changelog, setChangelog] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setBuilds({ state: 'loading' });
    try {
      setBuilds({ state: 'ready', value: await client.builds(limit) });
    } catch (error) {
      // Reported, never rendered as an empty list. "No builds need review" is
      // the sentence somebody merges on.
      setBuilds({ state: 'failed', why: messageOf(error) });
    }
  }, [client, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  if (changelog) return <ChangelogPage client={client} onBack={() => setChangelog(false)} />;

  if (builds.state === 'loading') return <p className="va-note">Loading builds…</p>;
  if (builds.state === 'failed') return <Failure why={builds.why} retry={load} />;

  if (open !== null) {
    return (
      <BuildPage
        client={client}
        reviewer={reviewer}
        build={open}
        onBack={() => {
          setOpen(null);
          void load();
        }}
      />
    );
  }

  return (
    <>
      <nav className="va-nav">
        <button type="button" className="va-current" disabled>
          Builds
        </button>
        <button type="button" onClick={() => setChangelog(true)}>
          Changelog
        </button>
      </nav>
      <BuildList builds={builds.value} onOpen={setOpen} />
    </>
  );
}

export function BuildList({
  builds,
  onOpen,
}: {
  readonly builds: readonly BuildSummary[];
  readonly onOpen: (build: string) => void;
}): ReactElement {
  if (builds.length === 0) return <p className="va-note">No builds have been posted yet.</p>;

  return (
    <ol className="va-builds">
      {builds.map((build) => (
        <li key={build.build} className="va-build">
          <button type="button" className="va-build-open" onClick={() => onOpen(build.build)}>
            <span className="va-build-id">{build.build}</span>
            <code className="va-commit">{build.commit.slice(0, 8)}</code>
            {build.branch === undefined ? null : <span className="va-branch">{build.branch}</span>}
          </button>
          <Verdicts build={build} />
          <CoverageLine coverage={build.coverage} />
        </li>
      ))}
    </ol>
  );
}

/**
 * The counts, with `pending` given the emphasis.
 *
 * `unchanged` is the large number and the uninteresting one. What decides whether
 * anybody has to open this build is how many subjects still have nobody's name
 * against them.
 */
function Verdicts({ build }: { readonly build: BuildSummary }): ReactElement {
  return (
    <p className="va-verdicts">
      <span className={build.pending > 0 ? 'va-pending' : 'va-settled'}>
        {build.pending > 0 ? `${build.pending} awaiting review` : 'nothing awaiting review'}
      </span>
      <span className="va-counts">
        {build.verdicts.changed} changed · {build.verdicts.new} new ·{' '}
        {build.verdicts.incomparable} incomparable · {build.verdicts.unchanged} unchanged
      </span>
    </p>
  );
}

/**
 * What the run said about the subjects it did not observe — including that it
 * said nothing.
 *
 * The three states are not two. A run that stated its coverage and skipped
 * nothing is clean; a run that stated it and failed on fifty is not; and a run
 * that never said is **unknown**, which must not be drawn as the first. That is
 * the collapse `RunReport.notObserved` exists to prevent, and drawing `0 failed`
 * for a silent writer would reintroduce it at the last possible moment.
 */
export function CoverageLine({ coverage }: { readonly coverage: BuildSummary['coverage'] }): ReactElement {
  if (!coverage.stated) {
    return (
      <p className="va-coverage va-unknown">
        This report did not say which subjects it skipped, so its coverage is unknown — not clean.
      </p>
    );
  }
  if (coverage.failed === 0 && coverage.excluded === 0) {
    return <p className="va-coverage">Every planned subject was observed.</p>;
  }
  return (
    <p className={coverage.failed > 0 ? 'va-coverage va-incomplete' : 'va-coverage'}>
      {coverage.failed} failed to render · {coverage.excluded} excluded by configuration
    </p>
  );
}

function BuildPage({
  client,
  reviewer,
  build,
  onBack,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: string;
  readonly onBack: () => void;
}): ReactElement {
  const [detail, setDetail] = useState<Loaded<BuildDetail>>({ state: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    try {
      setDetail({ state: 'ready', value: await client.build(build) });
    } catch (error) {
      setDetail({ state: 'failed', why: messageOf(error) });
    }
  }, [client, build]);

  useEffect(() => {
    void load();
  }, [load]);

  if (detail.state === 'loading') return <p className="va-note">Loading {build}…</p>;
  if (detail.state === 'failed') return <Failure why={detail.why} retry={load} />;

  const value = detail.value;

  return (
    <article className="va-build-page">
      <button type="button" className="va-back" onClick={onBack}>
        ← all builds
      </button>
      <h1>{value.build}</h1>
      <p className="va-subtitle">
        <code>{value.commit.slice(0, 8)}</code>
        {value.branch === undefined ? null : <> on {value.branch}</>} · {value.identity.engine} on{' '}
        {value.identity.platform}
      </p>
      {value.intent === undefined ? null : (
        <p className="va-intent">
          Declared intent: <em>{value.intent}</em>
        </p>
      )}
      <CoverageLine coverage={value.coverage} />

      <Docket causes={value.causes} />

      <Variations variations={value.variations} />

      <h2>Subjects</h2>
      {value.subjects
        .filter((subject) => subject.verdict !== 'unchanged')
        .map((subject) => (
          <SubjectPanel
            key={subject.subject}
            client={client}
            reviewer={reviewer}
            build={value.build}
            subject={subject}
            onDecided={load}
          />
        ))}

      {value.notObserved.length === 0 ? null : (
        <>
          <h2>Not observed</h2>
          <ul className="va-not-observed">
            {value.notObserved.map((entry) => (
              <li key={entry.subject} className={entry.kind === 'failed' ? 'va-failed' : ''}>
                <strong>{entry.subject}</strong> — {entry.because}
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

/**
 * The docket: what a reviewer reads before looking at a single pixel.
 *
 * Each row is a component the semantic tier named as a cause, the file it is
 * declared in, and how many subjects it reached. Collateral is one number for the
 * build, deliberately not split between causes — deciding which edit pushed which
 * box around is exactly the attribution the tier declined to claim, and inventing
 * it here would put a confident wrong number on the page.
 */
export function Docket({ causes }: { readonly causes: readonly Cause[] }): ReactElement {
  if (causes.length === 0) {
    return <p className="va-note">No component was named as a cause in this build.</p>;
  }

  return (
    <section className="va-docket">
      <h2>Causes</h2>
      <table>
        <thead>
          <tr>
            <th>component</th>
            <th>file</th>
            <th>subjects</th>
            <th>cause pixels</th>
          </tr>
        </thead>
        <tbody>
          {causes.map((cause) => (
            <tr key={cause.component}>
              <td>
                <strong>{cause.component}</strong>
              </td>
              <td>
                <code>{cause.file ?? '—'}</code>
              </td>
              <td>{cause.subjects.length}</td>
              <td>{cause.pixels}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="va-collateral">
        {causes[0]?.collateralPixels ?? 0} collateral pixels across this build — regions that moved
        because something else did. Counted, not listed: ranked by area they would outrank the edit.
      </p>
    </section>
  );
}

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
}: {
  readonly variations: readonly VariationRecord[];
}): ReactElement | null {
  if (variations.length === 0) return null;

  const ordered = [...variations].sort((left, right) => {
    const byRank = rankOf(left) - rankOf(right);
    if (byRank !== 0) return byRank;
    return left.subject < right.subject ? -1 : left.subject > right.subject ? 1 : 0;
  });

  return (
    <section className="va-variations">
      <h2>Variations</h2>
      <p className="va-note">
        Subjects read against the subject they vary from, in this run. Not verdicts — a variation is
        a difference somebody meant. What is worth reading is a variation that turns out to be no
        difference at all.
      </p>
      <ul className="va-variation-list">
        {ordered.map((variation) => (
          <li key={variation.subject} className={`va-variation ${STATES[rankOf(variation)] ?? ''}`}>
            <p className="va-variation-head">
              <strong>{variation.subject}</strong>
              {variation.parent === undefined ? null : (
                <>
                  {' '}
                  from <strong>{variation.parent}</strong>
                </>
              )}{' '}
              <span className="va-axis">{axisOf(variation)}</span>
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
            <p className="va-because">{variation.because}</p>
          </li>
        ))}
      </ul>
    </section>
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

export function SubjectPanel({
  client,
  reviewer,
  build,
  subject,
  onDecided,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: string;
  readonly subject: SubjectView;
  readonly onDecided: () => void;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const decide = async (decision: Decision): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      await client.decide(build, subject.subject, decision, reviewer);
      onDecided();
    } catch (error) {
      // Kept on the page rather than swallowed. A decision that silently did not
      // land is a reviewer who believes a baseline was promoted and a next run
      // that reports the same change again.
      setFailed(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="va-subject">
      <header>
        <h3>{subject.subject}</h3>
        <span className={`va-verdict va-${subject.verdict}`}>{subject.verdict}</span>
        <span className="va-because">{subject.because}</span>
      </header>

      {subject.decision === null ? null : (
        <p className="va-decision">
          {subject.decision.decision} by {subject.decision.by} at {subject.decision.at}
          {subject.decision.note === undefined ? null : <> — {subject.decision.note}</>}
        </p>
      )}

      <Viewer client={client} build={build} subject={subject} />

      <Findings subject={subject} />

      <SubjectHistory client={client} subject={subject} />

      {failed === null ? null : <p className="va-failure">{failed}</p>}

      <p className="va-actions">
        <button
          type="button"
          disabled={busy || !subject.approvable}
          onClick={() => void decide('approved')}
          title={
            subject.approvable
              ? 'Make this build’s candidate the baseline'
              : 'This run kept no candidate image, so there is nothing to promote. Approving would mean rendering one now, which is recording rather than promoting.'
          }
        >
          Approve
        </button>
        <button type="button" disabled={busy} onClick={() => void decide('rejected')}>
          Reject
        </button>
        {subject.approvable ? null : (
          <span className="va-note">
            No candidate was uploaded for this subject, so it cannot be approved here.
          </span>
        )}
      </p>
    </section>
  );
}

/**
 * Findings, and the difference between clean and unexamined.
 *
 * `[]` means this render was inspected and no defect was found. `undefined` means
 * nothing inspected it. Printing the second as the first tells a reviewer the
 * component is fine on the authority of something that never looked.
 */
function Findings({ subject }: { readonly subject: SubjectView }): ReactElement | null {
  if (subject.findings === undefined) {
    return <p className="va-note">This render was not inspected, so no defect list applies.</p>;
  }
  if (subject.findings.length === 0) return null;

  return (
    <ul className="va-findings">
      {subject.findings.map((finding, index) => (
        <li key={`${finding.rule}-${finding.path}-${String(index)}`}>
          <code>{finding.rule}</code> {finding.what}
          {finding.component === undefined ? null : (
            <>
              {' '}
              — <strong>{finding.component}</strong>
            </>
          )}
          {finding.file === undefined ? null : <> <code>{finding.file}</code></>}
        </li>
      ))}
    </ul>
  );
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
