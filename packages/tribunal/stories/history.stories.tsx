/**
 * The panels that read the record rather than the run, over the recorded builds.
 *
 * The build list and its coverage line, the changelog, a subject's history and
 * the two sentences it is made of, the settled fold, the rail's tasks, and what
 * the commit reaches — each at the width it has on the page, so a change to
 * `src/ui` that rewraps one of them moves an image here.
 *
 * The recorded service has no history behind the two builds, so its flakiness
 * and churn answers are the *unknown* ones, and the run carried no diff, so its
 * `reach` is null. The other states spread a recorded answer and change only
 * what makes the state; the reach is the recorded composition, read as the
 * diff to `ds.jsx` the second build was made from.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Churn, Flakiness, Reach } from '@variance-authority/history';
import { userEvent, waitFor, within } from 'storybook/test';
import type { Concern } from '../src/concern-types.js';
import type { BuildDetail, BuildSummary, ReachView, SubjectView } from '../src/review-types.js';
import type { TribunalChangelog } from '../src/review.js';
import { BuildList, CoverageLine, NoBuilds } from '../src/ui/builds.js';
import { ChangelogEntries, ChurnLine, StabilityLine, SubjectHistory } from '../src/ui/history.js';
import { OutcomeMapView } from '../src/ui/outcome.js';
import { ReachPanel } from '../src/ui/reach.js';
import { Settled, needsReview } from '../src/ui/settled.js';
import { Tasks, tasksOf } from '../src/ui/tasks.js';
import { BASE, CHANGED, buildOf, recorded, replayClient, replayed, subjectOf, summaries } from './replay.js';

/** Widths at the gate's 1280px viewport: the page, a card on it, the subject aside, the rail. */
const PAGE = 1096;
const CARD = 1058;
const ASIDE = 284;
const RAIL = 316;

const client = replayClient();
const changed = buildOf(CHANGED);
const latest = summaries()[0] as BuildSummary;
const DS = (changed.causes[0]?.file ?? '').replace(/:\d+$/, '');
const CONFIG = 'cases/storybook-case/variance.config.json';
const AGAINST = buildOf(BASE).branch ?? 'main';

const flakiness = recorded<Flakiness>('/v1/flakiness?subject=story%3Acase-surface--card-rebranded');
const churn = recorded<Churn>('/v1/churn?component=Button');
const reached = recorded<Reach>('/v1/reach?component=Button');
const concerns = recorded<{ concerns: Concern[] }>(`/review/concerns?build=${CHANGED}`).concerns;
const changelog = recorded<TribunalChangelog>('/review/changelog');

/** The subjects the recorded composition places each component in. */
const placed = (component: string): readonly string[] =>
  changed.composition?.find((one) => one.component === component)?.subjects ?? [];

/** A diff from `ds.jsx` that the import graph carries to `components`. */
function reachTo(components: readonly string[], seeds: readonly string[] = [DS]): ReachView {
  return {
    against: AGAINST,
    changed: seeds,
    components: components.map((component) => ({ component, trail: [DS, component] })),
    subjects: Object.fromEntries(
      changed.subjects.map(({ subject }) => {
        const through = components.filter((component) => placed(component).includes(subject));
        return [
          subject,
          through.length === 0
            ? { reached: false, through, because: 'no component this subject renders is reached by the diff' }
            : { reached: true, through, trail: [DS, through[0] ?? ''], because: `reached through ${through.join(', ')}` },
        ];
      }),
    ),
  };
}

const withReach = (reach: ReachView): BuildDetail => ({ ...changed, reach });

/** The commit as it was made: the `Button` edit, which also reaches `Card`. */
const LANDED = withReach(reachTo(['Button', 'Card'], [DS, CONFIG]));
/** An edit that reached `Clock` and `SheetLeak` while `Button` moved five renders. */
const MISSED = withReach(reachTo(['Clock', 'SheetLeak']));
/** A diff the graph could not attribute: the refusal drawn instead of the grid. */
const REFUSED = withReach({
  against: AGAINST,
  changed: [CONFIG],
  components: [],
  whole: `${CONFIG} is not in the import graph`,
  unscanned: [CONFIG],
});

const ask =
  (button: RegExp): NonNullable<Story['play']> =>
  async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText(button));
    await waitFor(() => {
      if (canvas.queryByText('Reading the record…') !== null) throw new Error('still reading');
    });
    await replayed();
  };

const open: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const summary = canvasElement.querySelector('summary');
  if (summary !== null) await userEvent.click(summary);
  await replayed();
};

const meta = {
  title: 'Tribunal/History',
  parameters: { width: PAGE },
  play: replayed,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const BuildListBothBuilds: Story = {
  render: () => <BuildList builds={summaries()} go={() => {}} endpoint={client.endpoint} />,
};
export const BuildListFirstRunOnly: Story = {
  render: () => <BuildList builds={summaries().filter((one) => one.build === BASE)} go={() => {}} endpoint={client.endpoint} />,
};
export const NoBuildsEmptyStore: Story = {
  render: () => <NoBuilds endpoint={client.endpoint} />,
};

const coverage = (over: Partial<BuildSummary['coverage']>): BuildSummary => ({
  ...latest,
  coverage: { ...latest.coverage, ...over },
});

export const CoverageStated: Story = {
  render: () => <CoverageLine build={latest} />,
};
/** A report that never said which subjects it skipped. */
export const CoverageUnknown: Story = {
  render: () => <CoverageLine build={coverage({ stated: false })} />,
};
/** Two subjects failed to render. */
export const CoverageIncomplete: Story = {
  render: () => <CoverageLine build={coverage({ failed: 2 })} />,
};
/** A narrowed run that ruled six subjects out of the change's reach. */
export const CoverageNarrowed: Story = {
  render: () => <CoverageLine build={coverage({ unreached: 6 })} />,
};

const decided = subjectOf(CHANGED, 'story:case-surface--button-primary');

export const ChangelogApproved: Story = {
  render: () => <ChangelogEntries log={changelog} />,
};
/** The same approval, stored without a shape: a run that read no markup for it. */
export const ChangelogUngrouped: Story = {
  render: () => (
    <ChangelogEntries
      log={{
        changes: [],
        ungrouped: [
          {
            build: CHANGED,
            subject: decided.subject,
            commit: changed.commit,
            by: decided.decision?.by ?? '',
            at: decided.decision?.at ?? changed.at,
            regions: [],
          },
        ],
      }}
    />
  ),
};
export const ChangelogFilteredEmpty: Story = {
  render: () => <ChangelogEntries log={recorded<TribunalChangelog>('/review/changelog?component=Card')} filter="Card" />,
};
export const ChangelogNothingApproved: Story = {
  render: () => <ChangelogEntries log={recorded<TribunalChangelog>('/review/changelog?component=Card')} />,
};

export const HistoryNotAsked: Story = {
  parameters: { width: ASIDE },
  render: () => <SubjectHistory client={client} subject={subjectOf(CHANGED, 'story:case-surface--card-rebranded')} />,
};
export const HistoryEmptyRecord: Story = {
  parameters: { width: ASIDE },
  render: () => <SubjectHistory client={client} subject={subjectOf(CHANGED, 'story:case-surface--card-rebranded')} />,
  play: ask(/Has this changed before/),
};
export const HistoryNoCause: Story = {
  parameters: { width: ASIDE },
  render: () => <SubjectHistory client={client} subject={subjectOf(CHANGED, 'story:case-surface--loading')} />,
  play: ask(/Has this changed before/),
};

export const StabilityUnknown: Story = {
  parameters: { width: ASIDE },
  render: () => <StabilityLine flakiness={flakiness} />,
};
/** Swept twelve times and never disagreed with itself. */
export const StabilitySteady: Story = {
  parameters: { width: ASIDE },
  render: () => <StabilityLine flakiness={{ ...flakiness, runs: 12, sweeps: 12, rate: 0 }} />,
};
/** A live flake: six of twenty sweeps, the latest among them, with a named cause. */
export const StabilityFlaky: Story = {
  parameters: { width: ASIDE },
  render: () => (
    <StabilityLine
      flakiness={{
        ...flakiness,
        runs: 20,
        sweeps: 20,
        occurrences: 6,
        rate: 0.3,
        absorbedRuns: 2,
        causes: [{ component: 'Card', band: 'geometry', runs: 6 }],
      }}
    />
  ),
};
/** The same six, none in the last nine sweeps: a flake somebody fixed. */
export const StabilitySettledFlake: Story = {
  parameters: { width: ASIDE },
  render: () => (
    <StabilityLine flakiness={{ ...flakiness, runs: 20, sweeps: 20, occurrences: 6, rate: 0.3, sweepsSince: 9 }} />
  ),
};

export const ChurnUnknown: Story = {
  parameters: { width: ASIDE },
  render: () => <ChurnLine component="Button" churn={churn} reach={reached} />,
};
/** Button with a history: four approved changes, three displacements, one rejection. */
export const ChurnChanging: Story = {
  parameters: { width: ASIDE },
  render: () => (
    <ChurnLine
      component="Button"
      churn={{ ...churn, runs: 20, changedRuns: 4, collateralRuns: 3, rejectedRuns: 1, lastAt: decided.decision?.at ?? changed.at }}
      reach={{ ...reached, subjects: placed('Button'), arrived: [decided.subject] }}
    />
  ),
};

const settled = (subjects: readonly SubjectView[]) => (
  <Settled subjects={subjects} ignores={changed.declarations.ignores} build={CHANGED} go={() => {}} />
);
const absorbed = changed.subjects.map((subject): SubjectView => {
  // Two of the nine unchanged subjects turned green by a declaration instead.
  if (subject.subject.endsWith('--deferred')) {
    return { ...subject, verdict: 'ignored', ignored: { pixels: 412, boxes: 1, inert: 0, byRule: { 'clock-face': 412 } } };
  }
  if (subject.subject.endsWith('--loading')) return { ...subject, verdict: 'ignored' };
  return subject;
});

export const SettledFolded: Story = {
  parameters: { width: CARD },
  render: () => settled(changed.subjects),
};
export const SettledOpen: Story = {
  parameters: { width: CARD },
  render: () => settled(changed.subjects),
  play: open,
};
export const SettledAbsorbedByRules: Story = {
  parameters: { width: CARD },
  render: () => settled(absorbed),
  play: open,
};

const queue = changed.subjects.filter((subject) => needsReview(subject.verdict));

export const TasksCounted: Story = {
  parameters: { width: RAIL },
  render: () => <Tasks tasks={tasksOf(queue, changed.subjects, concerns)} chosen={undefined} onChoose={() => {}} />,
};
export const TasksUnreviewedChosen: Story = {
  parameters: { width: RAIL },
  render: () => <Tasks tasks={tasksOf(queue, changed.subjects, concerns)} chosen="unreviewed" onChoose={() => {}} />,
};
export const TasksConcernsLoading: Story = {
  parameters: { width: RAIL },
  render: () => <Tasks tasks={tasksOf(queue, changed.subjects, undefined)} chosen={undefined} onChoose={() => {}} />,
};
export const TasksConcernsUnread: Story = {
  parameters: { width: RAIL },
  render: () => (
    <Tasks tasks={tasksOf(queue, changed.subjects, 'the concerns route answered 503')} chosen={undefined} onChoose={() => {}} />
  ),
};

export const OutcomeCauseAndConfig: Story = {
  parameters: { width: CARD },
  render: () => <OutcomeMapView build={LANDED} />,
};
export const OutcomeEditMissed: Story = {
  parameters: { width: CARD },
  render: () => <OutcomeMapView build={MISSED} />,
};

export const ReachLanded: Story = {
  parameters: { width: CARD },
  render: () => <ReachPanel client={client} build={LANDED} />,
};
export const ReachMovedUnreached: Story = {
  parameters: { width: CARD },
  render: () => <ReachPanel client={client} build={MISSED} />,
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      if (within(canvasElement).queryByText('Reading the record…') !== null) throw new Error('still reading');
    });
    await replayed();
  },
};
export const ReachRefused: Story = {
  parameters: { width: CARD },
  render: () => <ReachPanel client={client} build={REFUSED} />,
};
