/**
 * This run against the run before it — which is a different question from this
 * run against its baseline, and the one nobody in the category asks.
 *
 * A build page compares a candidate to a baseline and stops. So a difference that
 * arrived on Tuesday, went undecided, and arrived again on Wednesday is drawn on
 * Wednesday exactly as it was on Tuesday: eighteen thumbnails, no memory, and a
 * reviewer re-reading a docket they already read. The second reading costs the
 * same as the first, which is why the fourth one does not happen.
 *
 * The shape digest is what makes the answer exact rather than approximate. Two
 * runs whose leading regions carry the same fingerprint are carrying *the same
 * difference*, not a similar one, and that licenses the only sentence worth
 * printing here: **you have seen this, and it has not moved since.**
 *
 * ## The decision on the earlier run is part of the finding
 *
 * A difference that is identical to build 5's, where build 5 approved it, means
 * the approval did not reach the baseline. Identical where build 5 rejected it
 * means it came back. Identical where nobody decided means the docket is a queue
 * and this is its second delivery. Same shape, three different afternoons — so the
 * earlier decision is carried onto the row rather than summarised away.
 *
 * ## Absent is not equal
 *
 * A run that recorded no shape for its leading region said nothing, and two runs
 * that both said nothing did not agree. Those get their own state and their own
 * sentence, because folding them into *the same difference again* would be a
 * confident claim about a pair nothing measured — on the one screen where the
 * claim tells somebody they can skip looking.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { greenBecause } from '@variance-authority/report';
import type { BuildDetail, BuildSummary, SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { shapeOf } from './lead.js';
import { count, number, when } from './text.js';

/** What became of one subject between the two runs. */
export type Shift =
  | 'differently'
  | 'unsaid'
  | 'first'
  | 'new'
  | 'again'
  | 'settled'
  | 'declared'
  | 'absorbed'
  | 'unmasked'
  | 'unplaced'
  | 'uncompared'
  | 'dropped'
  | 'held';

export interface Shifted {
  readonly subject: string;
  readonly shift: Shift;
  /** This run's reading. Absent only when the subject was dropped. */
  readonly now?: SubjectView;
  /** The earlier run's reading, including whatever was decided about it. */
  readonly earlier?: SubjectView;
}

export interface Divergence {
  readonly shifts: readonly Shifted[];
  /** Subjects both runs compared and neither found a difference in. */
  readonly held: number;
}

/**
 * The two runs crossed, one row per subject either of them named.
 *
 * Union rather than intersection: a subject the earlier run had and this one does
 * not is a suite that shrank, and an intersection would report that as nothing
 * having happened.
 */
export function divergeFrom(now: BuildDetail, prior: BuildDetail): Divergence {
  const before = new Map(prior.subjects.map((subject) => [subject.subject, subject]));
  const shifts: Shifted[] = [];
  let held = 0;

  for (const subject of now.subjects) {
    const earlier = before.get(subject.subject);
    before.delete(subject.subject);
    const shift = shiftOf(subject, earlier);
    if (shift === 'held') held += 1;
    else shifts.push({ subject: subject.subject, shift, now: subject, ...(earlier === undefined ? {} : { earlier }) });
  }

  for (const earlier of before.values()) {
    shifts.push({ subject: earlier.subject, shift: 'dropped', earlier });
  }

  return { shifts, held };
}

/**
 * Whether a verdict describes a pair this run actually put side by side.
 *
 * `ignored` belongs here and reads as though it does not. A declaration decided
 * it, but the comparison it decided happened: there was a baseline, there were
 * differing pixels, and every one of them landed somewhere the operator wrote
 * down. Filing it with `incomparable` told a reviewer *no baseline was put beside
 * them here* about subjects that were compared — an absence invented on top of a
 * measurement, which is the one thing this panel exists not to do.
 */
function compared(subject: SubjectView): boolean {
  return (
    subject.verdict === 'changed' ||
    subject.verdict === 'unchanged' ||
    subject.verdict === 'ignored'
  );
}

function shiftOf(now: SubjectView, earlier: SubjectView | undefined): Shift {
  if (earlier === undefined) return 'new';
  if (!compared(now)) return 'uncompared';
  if (!compared(earlier)) return 'unplaced';

  // A declaration standing over both runs is bookkeeping; one that arrived
  // between them is a rule that has just taken a subject out of review, and the
  // subject it took is named. That is the moment a mask starts covering
  // something, and it is visible exactly once — here.
  if (now.verdict === 'ignored') return earlier.verdict === 'ignored' ? 'declared' : 'absorbed';

  // The other direction. A subject a rule absorbed there and nothing absorbs
  // here either stopped differing — which is `settled`, and true whether or not
  // a rule was watching — or is being reported, which is the rule failing to
  // cover what it was written for.
  if (earlier.verdict === 'ignored') return now.verdict === 'unchanged' ? 'settled' : 'unmasked';

  if (now.verdict === 'unchanged') return earlier.verdict === 'unchanged' ? 'held' : 'settled';
  if (earlier.verdict === 'unchanged') return 'first';

  const here = shapeOf(now);
  const there = shapeOf(earlier);
  if (here === undefined || there === undefined) return 'unsaid';
  return here === there ? 'again' : 'differently';
}

/**
 * The order the states are read in, and what each one is worth saying.
 *
 * Ranked by what it costs to miss, not by how many subjects land in it. *The same
 * difference again* is usually the largest group and the least urgent one: it is
 * the part of the docket a reviewer can take in one decision, which is exactly why
 * it is not allowed to open the section and bury the two states above it.
 */
const SHIFTS: readonly {
  readonly shift: Shift;
  readonly title: string;
  readonly tone: string;
  readonly say: (against: string) => string;
}[] = [
  {
    shift: 'differently',
    title: 'Moved again, and not the same way',
    tone: 'va-shift-alarm',
    say: (against) =>
      `These differed in ${against} too, and the shape of the difference has changed since. Whatever is moving here is still moving.`,
  },
  {
    shift: 'unsaid',
    title: 'Moved again; nothing recorded says whether it is the same',
    tone: 'va-shift-ask',
    say: (against) =>
      `Both runs found a difference, and at least one of them localised no shape for it. Nothing here may call these identical to ${against}, or different from it.`,
  },
  {
    shift: 'first',
    title: 'Moved for the first time',
    tone: 'va-shift-alarm',
    say: (against) => `${against} compared these and found nothing. This run found a difference.`,
  },
  {
    shift: 'unmasked',
    title: 'A rule stopped absorbing these',
    tone: 'va-shift-alarm',
    say: (against) =>
      `${against} reported these green because a declaration absorbed their difference, and this run reports one. Either the rule stopped matching, or something moved outside what it covers — and the second is what a mask over a real regression looks like from the outside.`,
  },
  {
    shift: 'absorbed',
    title: 'A rule now decides these',
    tone: 'va-shift-ask',
    say: (against) =>
      `${against} put these in front of a reviewer and this run does not: a declaration in the config now takes their difference. That is the intended effect of writing one, and it is also how a subject leaves review without anybody deciding it.`,
  },
  {
    shift: 'new',
    title: 'New to this run',
    tone: 'va-shift-quiet',
    say: (against) => `${against} had no such subject, so there is nothing to place these against.`,
  },
  {
    shift: 'again',
    title: 'The same difference, again',
    tone: 'va-shift-known',
    say: (against) =>
      `The shape ${against} already carried, unchanged. Deciding it there would have settled it here.`,
  },
  {
    shift: 'settled',
    title: 'No longer moving',
    tone: 'va-shift-good',
    say: (against) => `${against} found a difference in these. This run agrees with the baseline.`,
  },
  {
    shift: 'declared',
    title: 'Green because a rule says so',
    tone: 'va-shift-known',
    say: () =>
      'Compared, found to differ, and decided by a declaration this config names. Nothing is awaiting review here; what is worth reading is the ledger below, which says what each rule absorbed and what it no longer does.',
  },
  {
    shift: 'unplaced',
    title: 'The earlier run never compared these',
    tone: 'va-shift-quiet',
    say: (against) =>
      `${against} recorded no comparison for them — no baseline, or nothing to compare — so this run's reading stands alone.`,
  },
  {
    shift: 'uncompared',
    title: 'This run did not compare these',
    tone: 'va-shift-quiet',
    say: () => 'No baseline was put beside them here, so nothing about their history applies yet.',
  },
  {
    shift: 'dropped',
    title: 'Gone since the earlier run',
    tone: 'va-shift-ask',
    say: (against) => `${against} carried these and this run does not. The suite lost them.`,
  },
];

/** How many subjects a group names before the rest become a count. */
const NAMED = 6;

export function DivergencePanel({
  client,
  build,
}: {
  readonly client: ReviewClient;
  readonly build: BuildDetail;
}): ReactElement | null {
  const [earlier, setEarlier] = useState<
    | { readonly state: 'loading' }
    | { readonly state: 'none' }
    | { readonly state: 'failed'; readonly why: string }
    | { readonly state: 'ready'; readonly value: BuildDetail }
  >({ state: 'loading' });

  const load = useCallback(async (): Promise<void> => {
    try {
      const builds = await client.builds();
      const previous = previousOf(builds, build.build);
      if (previous === undefined) {
        setEarlier({ state: 'none' });
        return;
      }
      setEarlier({ state: 'ready', value: await client.build(previous.build) });
    } catch (error) {
      // Reported, never swallowed. An empty section here reads as *nothing has
      // changed since the last run*, which is the sentence somebody merges on.
      setEarlier({ state: 'failed', why: error instanceof Error ? error.message : String(error) });
    }
  }, [client, build.build]);

  useEffect(() => {
    void load();
  }, [load]);

  if (earlier.state === 'loading') return null;
  if (earlier.state === 'none') {
    return (
      <section className="va-card">
        <h2>Since the last run</h2>
        <p className="va-note">
          There is no earlier run of this project to place this one against. Everything here is
          being read for the first time.
        </p>
      </section>
    );
  }
  if (earlier.state === 'failed') {
    return (
      <section className="va-card">
        <h2>Since the last run</h2>
        <p className="va-failure">
          The earlier run could not be read, so nothing on this page says which of these differences
          you have already seen: {earlier.why}
        </p>
      </section>
    );
  }

  return <Crossed now={build} earlier={earlier.value} />;
}

/**
 * The run before this one, as the store lists them.
 *
 * By position rather than by clock. Two runs pushed from one machine can carry
 * the same timestamp to the millisecond — both example builds here do — and
 * picking on `at` would compare a build against itself or against its own
 * successor. The listing is newest first and breaks a tied clock by arrival, so
 * position is a total order where the timestamp is not. The build it lands on is
 * named on the page, because a reader who disagrees with the pick can only say so
 * if they can see it.
 */
function previousOf(
  builds: readonly BuildSummary[],
  build: string,
): BuildSummary | undefined {
  const at = builds.findIndex((each) => each.build === build);
  return at === -1 ? undefined : builds[at + 1];
}

function Crossed({
  now,
  earlier,
}: {
  readonly now: BuildDetail;
  readonly earlier: BuildDetail;
}): ReactElement {
  const { shifts, held } = divergeFrom(now, earlier);
  const against = `build ${earlier.build}`;
  const known = shifts.filter((each) => each.shift === 'again').length;
  // `unmasked` counts here. A subject the earlier run showed nobody, because a
  // rule absorbed it, is a subject that run did not show you — and it is the one
  // the headline is least entitled to leave out.
  const fresh = shifts.filter((each) =>
    ['differently', 'first', 'new', 'unmasked'].includes(each.shift),
  ).length;

  return (
    <section className="va-card va-divergence">
      <h2>Since the last run</h2>
      <p className="va-subtitle">
        Against <strong>build {earlier.build}</strong>{' '}
        <code className="va-commit">{earlier.commit.slice(0, 8)}</code>
        {earlier.branch === undefined ? null : (
          <span className="va-note"> on {earlier.branch}</span>
        )}
        , {when(earlier.at)}.{' '}
        {shifts.length === 0
          ? 'Every subject read the same way in both runs.'
          : `${
              fresh === 0
                ? 'Nothing here is something that run did not show you'
                : `${count(fresh, 'subject')} here ${fresh === 1 ? 'is' : 'are'} something that run did not show you`
            }; ${count(known, 'subject')} ${known === 1 ? 'carries' : 'carry'} a difference it already had.`}
      </p>

      {SHIFTS.map((group) => {
        const members = shifts.filter((each) => each.shift === group.shift);
        if (members.length === 0) return null;
        return (
          <div key={group.shift} className={`va-shift ${group.tone}`}>
            <p className="va-shift-head">
              <span className="va-shift-title">{group.title}</span>
              <span className="va-shift-count va-num">{number(members.length)}</span>
            </p>
            <p className="va-note">{group.say(against)}</p>
            <ul className="va-shift-list">
              {members.slice(0, NAMED).map((each) => (
                <ShiftRow key={each.subject} shifted={each} against={against} />
              ))}
            </ul>
            {members.length > NAMED ? (
              <p className="va-note">
                and {number(members.length - NAMED)} more, in the rail.
              </p>
            ) : null}
          </div>
        );
      })}

      {held === 0 ? null : (
        <p className="va-note va-shift-held">
          {count(held, 'subject')} read the same in both runs and neither found a difference.
        </p>
      )}
    </section>
  );
}

/**
 * One subject, and the single fact that places it against the earlier run.
 *
 * Which fact that is depends on the state, because the useful number is not the
 * same one twice: a difference that changed size says so in pixels, and a
 * difference that arrived identical says what the earlier run decided about it —
 * which is the whole reason its identity matters.
 */
function ShiftRow({
  shifted,
  against,
}: {
  readonly shifted: Shifted;
  readonly against: string;
}): ReactElement {
  const { now, earlier } = shifted;

  return (
    <li className="va-shift-row">
      <span className="va-shift-subject">{shifted.subject}</span>
      {shifted.shift === 'differently' && now !== undefined && earlier !== undefined ? (
        <span className="va-note va-num">
          {number(earlier.changedPixels)} px → {number(now.changedPixels)} px
        </span>
      ) : null}
      {shifted.shift === 'again' ? <Standing earlier={earlier} against={against} /> : null}
      {shifted.shift === 'first' && now !== undefined ? (
        <span className="va-note va-num">{number(now.changedPixels)} px</span>
      ) : null}
      {shifted.shift === 'unmasked' && now !== undefined ? (
        <span className="va-note va-num">{number(now.changedPixels)} px, reported</span>
      ) : null}
      {shifted.shift === 'absorbed' ? <Absorbing now={now} earlier={earlier} /> : null}
    </li>
  );
}

/**
 * Which rule took a subject out of review, and what it was worth when it did.
 *
 * Both halves are read from the record and neither is invented. Where the build
 * did not store the per-subject block — an older push, or a service that dropped
 * it on the way in — the row says the rule is unnamed rather than leaving a
 * reader to assume the difference was too small to be worth one.
 */
function Absorbing({
  now,
  earlier,
}: {
  readonly now: SubjectView | undefined;
  readonly earlier: SubjectView | undefined;
}): ReactElement {
  const green = now === undefined ? undefined : greenBecause(now);
  const was = earlier === undefined ? null : (
    <span className="va-note va-num">{number(earlier.changedPixels)} px before</span>
  );

  if (green === undefined || green.kind === 'unsaid') {
    return (
      <>
        <span className="va-note">this build does not record which rule</span>
        {was}
      </>
    );
  }
  if (green.kind === 'relaxed') {
    return (
      <>
        <span className="va-mark va-ignored">{green.rule} · asserted on {green.level}</span>
        {was}
      </>
    );
  }
  if (green.kind === 'absorbed') {
    return (
      <>
        <span className="va-mark va-ignored">{green.rules.join(', ')}</span>
        <span className="va-note va-num">{number(green.pixels)} px absorbed</span>
      </>
    );
  }
  return <>{was}</>;
}

/**
 * What the earlier run decided about a difference this one is carrying again.
 *
 * Undecided is the common case and the one worth a word, because it is the
 * failure this whole section exists to name: a docket delivered twice to somebody
 * who read it once.
 */
function Standing({
  earlier,
  against,
}: {
  readonly earlier: SubjectView | undefined;
  readonly against: string;
}): ReactElement {
  const decision = earlier?.decision;
  if (decision === undefined || decision === null) {
    return <span className="va-note">undecided in {against}</span>;
  }
  return (
    <span className={decision.decision === 'approved' ? 'va-mark va-approved' : 'va-mark va-rejected'}>
      {decision.decision} in {against} by {decision.by}
    </span>
  );
}
