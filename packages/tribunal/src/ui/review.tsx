import type { VariationRecord } from '@variance-authority/report';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { BuildDetail, BuildSummary, Decision, SubjectView } from '../review.js';
import type { ReviewClient } from './client.js';
import { ChangelogPage, SubjectHistory } from './history.js';
import { Mark } from './mark.js';
import { OriginsPanel } from './origins.js';
import { ReachPanel } from './reach.js';
import { briefly, count, element, headline, number, segments, sentence, when } from './text.js';
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
 * 1. **The docket first**, and it is where a build opens. Components named as
 *    *causes*, largest cause first, with collateral counted rather than listed.
 *    One token change across 300 subjects is one item with a count.
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
 * ## One subject at a time, because the alternative was a mile of page
 *
 * A build page that expanded every changed subject came to twenty-seven thousand
 * pixels of document on twenty subjects, most of it render. That is the same
 * blindness arriving as a layout: a reviewer who scrolls past a full-page capture
 * to reach the next subject stops reading them, and a docket that ranks correctly
 * has bought nothing if the page below it cannot be read. So the build is a rail
 * of subjects, one open beside it, and the decision and the record in a column
 * that never moves — three panes that scroll separately and a document that does
 * not scroll at all.
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
 * ## And then the record, because "is this normal?" is the real question
 *
 * A difference is not a decision. The same 2px shift is a bug in a component
 * nobody has touched since March and a Tuesday in one that moves in nineteen runs
 * out of twenty, and a before-and-after cannot tell those apart. So the surface
 * reaches the same history the CLI writes — churn, reach, stability, and the
 * changelog of what was approved before — from [`history.tsx`](./history.tsx),
 * one subject at a time and only when asked.
 */

export { RegionOverlay, RegionTable, Viewer, modesFor, type ViewerMode } from './viewer.js';
export { ChangelogEntries, ChangelogPage, ChurnLine, StabilityLine, SubjectHistory } from './history.js';
export { ReachPanel, crossReach, type Crossing } from './reach.js';
export {
  OriginsPanel,
  originsOf,
  type Appearance,
  type Origin,
  type Origins,
} from './origins.js';

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

  if (changelog) {
    return (
      <div className="va-app">
        <ChangelogPage client={client} onBack={() => setChangelog(false)} />
      </div>
    );
  }

  if (open !== null) {
    return (
      <div className="va-app">
        <BuildPage
          client={client}
          reviewer={reviewer}
          build={open}
          onBack={() => {
            setOpen(null);
            void load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="va-app">
      <header className="va-topbar">
        <Mark />
        <span className="va-topbar-title">
          <strong>Variance Authority</strong>
          <span className="va-topbar-sub">
            {builds.state === 'ready' ? (builds.value[0]?.project ?? 'review') : 'review'}
          </span>
        </span>
        <nav className="va-nav va-topbar-meta">
          <button type="button" className="va-current" disabled>
            Builds
          </button>
          <button type="button" onClick={() => setChangelog(true)}>
            Changelog
          </button>
        </nav>
      </header>

      <div className="va-body va-scroll">
        <div className="va-page">
          {builds.state === 'loading' ? <p className="va-note">Loading builds…</p> : null}
          {builds.state === 'failed' ? <Failure why={builds.why} retry={load} /> : null}
          {builds.state === 'ready' ? <BuildList builds={builds.value} onOpen={setOpen} /> : null}
        </div>
      </div>
    </div>
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
          <p className="va-build-head">
            <button type="button" className="va-build-open" onClick={() => onOpen(build.build)}>
              <span className="va-build-id">{build.build}</span>
              <span className="va-build-go">Review →</span>
            </button>
            <code className="va-commit">{build.commit.slice(0, 8)}</code>
            {build.branch === undefined ? null : <span className="va-branch">{build.branch}</span>}
            <span className="va-when">{when(build.at)}</span>
          </p>
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
        {build.pending > 0 ? `${number(build.pending)} awaiting review` : 'nothing awaiting review'}
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

/**
 * A build: the rail, and whatever it is pointing at.
 *
 * `selected === null` is the docket, and it is where the page opens. A reviewer
 * arriving at a build should be told which components caused it before they are
 * shown a single render — that ordering is the product, and defaulting to the
 * first changed subject would quietly restore the category's.
 */
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
  const [selected, setSelected] = useState<string | null>(null);

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
  const reviewable = value.subjects.filter((subject) => subject.verdict !== 'unchanged');
  const current = reviewable.find((subject) => subject.subject === selected);

  return (
    <>
      <header className="va-topbar">
        <button type="button" className="va-back" onClick={onBack}>
          ←
        </button>
        <span className="va-topbar-title">
          <strong>Build {value.build}</strong>
          <span className="va-topbar-sub">{value.project}</span>
        </span>
        <span className={value.pending > 0 ? 'va-pill va-warn' : 'va-pill va-good'}>
          {value.pending > 0 ? `${number(value.pending)} awaiting review` : 'settled'}
        </span>
        <span className="va-topbar-meta">
          <code className="va-commit">{value.commit.slice(0, 8)}</code>
          {value.branch === undefined ? null : <span>{value.branch}</span>}
          <span>{value.identity.engine}</span>
          <span>{value.identity.platform}</span>
        </span>
      </header>

      <div className="va-body">
        <SubjectRail
          subjects={reviewable}
          causes={value.causes.length}
          variations={value.variations.length}
          selected={selected}
          onSelect={setSelected}
        />

        {current === undefined ? (
          <Overview client={client} reviewer={reviewer} build={value} onDecided={load} />
        ) : (
          <SubjectPanel
            client={client}
            reviewer={reviewer}
            build={value.build}
            subject={current}
            onDecided={load}
          />
        )}
      </div>
    </>
  );
}

/**
 * Every subject worth a decision, grouped by verdict and readable at a glance.
 *
 * The rail exists so that choosing what to look at costs a glance rather than a
 * scroll: the note under each name is the component the tier blamed and the size
 * of the difference, which is enough to decide whether this one needs opening at
 * all. Sorted largest-first inside each group, for the same reason the docket is.
 */
function SubjectRail({
  subjects,
  causes,
  variations,
  selected,
  onSelect,
}: {
  readonly subjects: readonly SubjectView[];
  readonly causes: number;
  readonly variations: number;
  readonly selected: string | null;
  readonly onSelect: (subject: string | null) => void;
}): ReactElement {
  const groups = [...new Set(subjects.map((subject) => subject.verdict))];

  return (
    <nav className="va-rail va-scroll">
      <button
        type="button"
        className={selected === null ? 'va-rail-item va-current' : 'va-rail-item'}
        onClick={() => onSelect(null)}
      >
        <span className="va-rail-body">
          <span className="va-rail-name">The docket</span>
          <span className="va-rail-note">
            {count(causes, 'cause')} · {count(variations, 'variation')}
          </span>
        </span>
      </button>

      {groups.map((verdict) => {
        const rows = subjects
          .filter((each) => each.verdict === verdict)
          .sort((left, right) => right.changedPixels - left.changedPixels);

        return (
          <section key={verdict}>
            <h2 className="va-rail-group">
              {verdict}
              <span className="va-rail-count va-num">{rows.length}</span>
            </h2>
            <ul>
              {rows.map((subject) => (
                <li key={subject.subject}>
                  <button
                    type="button"
                    className={
                      subject.subject === selected ? 'va-rail-item va-current' : 'va-rail-item'
                    }
                    onClick={() => onSelect(subject.subject)}
                  >
                    <span className={`va-dot va-${subject.verdict}`} />
                    <span className="va-rail-body">
                      <span className="va-rail-name">{subject.subject}</span>
                      <span className="va-rail-note">
                        {causeOf(subject) ?? 'no component named'}
                        {subject.changedPixels > 0 ? ` · ${briefly(subject)}` : ''}
                      </span>
                    </span>
                    {subject.decision === null ? null : (
                      <span className={`va-mark va-${subject.decision.decision}`}>
                        {subject.decision.decision === 'approved' ? '✓' : '✗'}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

/** Where a build opens: the changes, the variations, and what nothing looked at. */
function Overview({
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
  return (
    <div className="va-stage va-scroll">
      <div className="va-page">
        <h1>The docket</h1>
        <p className="va-subtitle">
          What caused this build, before a single render. Pick a subject from the rail to look at
          one.
        </p>

        {build.intent === undefined ? null : (
          <p className="va-intent" style={{ marginTop: '0.75rem' }}>
            Declared intent: <em>{build.intent}</em>
          </p>
        )}
        <CoverageLine coverage={build.coverage} />

        <div style={{ marginTop: '1.25rem' }}>
          <ReachPanel client={client} build={build} />
        </div>

        <section className="va-card">
          <OriginsPanel
            client={client}
            reviewer={reviewer}
            build={build}
            onDecided={onDecided}
          />
        </section>

        {build.variations.length === 0 ? null : (
          <section className="va-card">
            <Variations variations={build.variations} />
          </section>
        )}

        {build.notObserved.length === 0 ? null : (
          <section className="va-card">
            <h2>Not observed</h2>
            <ul className="va-not-observed">
              {build.notObserved.map((entry) => (
                <li key={entry.subject} className={entry.kind === 'failed' ? 'va-failed' : ''}>
                  <strong>{entry.subject}</strong> — <Prose text={entry.because} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * Report prose, with its identifiers set as identifiers.
 *
 * The sentences on this page were written by the observer, not by this surface,
 * and they are shown as written — this is the record, and a review page that
 * paraphrases it is a review page a reviewer cannot check. The only thing done
 * to them is typographic.
 */
export function Prose({ text }: { readonly text: string }): ReactElement {
  return (
    <>
      {segments(text).map((part, index) =>
        part.code ? (
          <code key={`${String(index)}-${part.text}`}>{part.text}</code>
        ) : (
          <Fragment key={`${String(index)}-${part.text}`}>{part.text}</Fragment>
        ),
      )}
    </>
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

/**
 * One subject: the render on the left, everything that is not the render on the
 * right.
 *
 * The split is not decoration. A reviewer decides from the defect list, the
 * record and the sentence explaining the verdict, and on a full-page capture all
 * three sat nine thousand pixels below the thing they are about. They are a
 * column now, and it does not move when the picture does.
 */
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
  const page = useRef<HTMLDivElement>(null);

  // This panel used to be remounted per subject, which threw away the comparison
  // mode and the magnification along with everything else — sixty re-clicks to
  // read twenty subjects the same way. Those are the reviewer's working method
  // and they stay; a failure from the last subject and its scroll position are
  // not, and are what the remount was really for.
  useEffect(() => {
    setBusy(false);
    setFailed(null);
    page.current?.scrollTo({ top: 0 });
  }, [subject.subject]);

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
      <div className="va-stage va-scroll" ref={page}>
        <div className="va-page">
          <header className="va-subject-head">
            <h3>{subject.subject}</h3>
            <span className={`va-verdict va-${subject.verdict}`}>{subject.verdict}</span>
          </header>
          <p className="va-because">{subject.because}</p>

          <Viewer client={client} build={build} subject={subject} />
        </div>
      </div>

      <aside className="va-aside va-scroll">
        <section className="va-card">
          <h2>Decision</h2>
          {subject.decision === null ? null : (
            <p className="va-decision">
              {subject.decision.decision} by {subject.decision.by} · {when(subject.decision.at)}
              {subject.decision.note === undefined ? null : <> — {subject.decision.note}</>}
            </p>
          )}
          {failed === null ? null : <p className="va-failure">{failed}</p>}
          <p className="va-actions">
            <button
              type="button"
              className="va-approve"
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
          </p>
          {subject.approvable ? null : (
            <p className="va-note" style={{ marginTop: '0.5rem' }}>
              No candidate was uploaded for this subject, so it cannot be approved here.
            </p>
          )}
        </section>

        <section className="va-card">
          <h2>Findings</h2>
          <Findings subject={subject} />
        </section>

        <section className="va-card">
          <h2>The record</h2>
          <SubjectHistory client={client} subject={subject} />
        </section>
      </aside>
    </section>
  );
}

/**
 * Findings, and the difference between clean and unexamined.
 *
 * `[]` means this render was inspected and no defect was found. `undefined` means
 * nothing inspected it. Printing the second as the first tells a reviewer the
 * component is fine on the authority of something that never looked.
 *
 * Drawn in three registers rather than one line. The report writes a rule id and
 * a clause — and the clause is written to *follow a noun the report never
 * prints*, which is how `label-mismatch reads "SNKR. shop" and is named …` used
 * to reach this page. So the headline is the defect in a person's words, the
 * element the clause was written for comes from `where`, and the id goes last,
 * beside the file, where it belongs: it is the least of the three to a reviewer
 * and the whole of it to an ignore list.
 */
function Findings({ subject }: { readonly subject: SubjectView }): ReactElement {
  if (subject.findings === undefined) {
    return <p className="va-note">This render was not inspected, so no defect list applies.</p>;
  }
  if (subject.findings.length === 0) {
    return <p className="va-note">Inspected, and nothing to report.</p>;
  }

  return (
    <ul className="va-findings">
      {subject.findings.map((finding, index) => (
        <li key={`${finding.rule}-${finding.path}-${String(index)}`} className="va-finding">
          <p className="va-finding-title">{headline(finding.rule)}</p>
          <p className="va-finding-where">{element(finding.where) ?? finding.path}</p>
          <p className="va-finding-what">{sentence(finding.what)}</p>
          <p className="va-finding-owner">
            {finding.component === undefined ? null : (
              <span className="va-tag">{finding.component}</span>
            )}
            {finding.file === undefined ? null : <code className="va-tag">{finding.file}</code>}
            <span className="va-tag va-rule">{finding.rule}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * The component the tier named as this subject's cause.
 *
 * The first region marked `cause`, in the order the report gave, and never the
 * largest: ranking by area names the container that reflowed instead of the edit
 * that moved it.
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
