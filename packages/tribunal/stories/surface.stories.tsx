/**
 * The pieces of the review surface that sit on every page or on one panel of
 * it: the shell, the mark, the run page's variations and journeys, and the
 * same-image grid of a subject's component.
 *
 * Each story is one state a reviewer meets, at the width the component has on
 * its page at a 1280-pixel window, so a change to its layout moves a picture
 * here. Builds, subjects and images are the recording's. The recorded case
 * declares no variations and records no journal, so those states are built on
 * the recorded build and its subjects, with images that resolve to recorded
 * captures.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { JourneyRegionRecord, JourneysReport, VariationRecord } from '@variance-authority/report';
import type { ReactElement, ReactNode } from 'react';
import type { BuildDetail } from '../src/review-types.js';
import { treeOf } from '../src/ui/journey-tree.js';
import { Timeline } from '../src/ui/journey-timeline.js';
import { familiesOf, JourneysPanel } from '../src/ui/journeys.js';
import { Mark } from '../src/ui/mark.js';
import { SameImageNote, Siblings } from '../src/ui/same-image.js';
import { Failure, Go, Nowhere, Prose, Skeleton, Stalled, Topbar, Waiting } from '../src/ui/shell.js';
import { Variations } from '../src/ui/variations.js';
import { BASE, CHANGED, buildOf, replayClient } from './replay.js';

const client = replayClient();
const go = (): void => {};
const base = buildOf(BASE);
const changed = buildOf(CHANGED);
const id = (member: string): string => `story:case-surface--${member}`;

const meta = {
  title: 'Tribunal/Surface',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The run page's content column, and the card every panel on it sits in. */
const RUN = 1096;
/** The docket's opening column, capped at 44rem. */
const OPENING = 648;
/** The subject page's stage, between the rail and the aside. */
const STAGE = 536;

const card = (children: ReactNode): ReactElement => <section className="va-card">{children}</section>;

/** A declared arm that differs, one that reaches nothing, and one whose parent the run never observed. */
const PAIRS: readonly VariationRecord[] = [
  {
    subject: id('button-secondary'),
    parent: id('button-primary'),
    identical: false,
    bands: ['token'],
    components: ['Button'],
    how: 'declared',
    because: '`story:case-surface--button-secondary` differs from `story:case-surface--button-primary` in token',
  },
  {
    subject: id('suspense-settles'),
    parent: id('deferred'),
    identical: true,
    bands: [],
    how: 'declared',
    because: '`story:case-surface--suspense-settles` renders identically to `story:case-surface--deferred`',
  },
  {
    subject: id('ticking'),
    because: 'the parent this subject declares was not observed in this run',
  },
];

/** The card stories varying on two axes from `card-rebranded`, with the combination of both unrendered. */
const LATTICE: readonly VariationRecord[] = [
  {
    subject: id('card-with-actions'),
    parent: id('card-rebranded'),
    identical: false,
    bands: ['geometry'],
    how: 'named',
    step: { axis: 'actions', position: 0, from: 'none', to: 'with' },
    because: '`story:case-surface--card-with-actions` differs from `story:case-surface--card-rebranded` in geometry',
  },
  {
    subject: id('composed'),
    parent: id('card-rebranded'),
    identical: false,
    bands: ['geometry', 'token'],
    how: 'named',
    step: { axis: 'layout', position: 1, from: 'single', to: 'composed' },
    because: '`story:case-surface--composed` differs from `story:case-surface--card-rebranded` in geometry and token',
  },
];

const pictures = (build: BuildDetail) => ({ client, build: build.build, subjects: build.subjects, go });

/** The first run: every side kept a candidate, and the identical pair is one picture twice. */
export const VariationsFirstRun: Story = {
  parameters: { width: RUN },
  render: () => card(<Variations variations={PAIRS} pictures={pictures(base)} />),
};

/** After the change: the changed pair kept candidates, the unchanged pair kept nothing to draw. */
export const VariationsUnchangedSides: Story = {
  parameters: { width: RUN },
  render: () => card(<Variations variations={PAIRS} pictures={pictures(changed)} />),
};

export const VariationsGrid: Story = {
  parameters: { width: RUN },
  render: () => card(<Variations variations={LATTICE} pictures={pictures(changed)} />),
};

/** A host that serves no images: the list is names only. */
export const VariationsNamesOnly: Story = {
  parameters: { width: RUN },
  render: () => card(<Variations variations={PAIRS} />),
};

/** The first run recorded `deferred` and `suspense-settles` as one image. */
export const SameImageNoteFirstRun: Story = {
  parameters: { width: OPENING },
  render: () => <SameImageNote build={base} go={go} />,
};

export const SiblingsOneOfTheSame: Story = {
  parameters: { width: STAGE },
  render: () => <Siblings client={client} build={base} subject={id('deferred')} go={go} />,
};

export const SiblingsBesideTheSame: Story = {
  parameters: { width: STAGE },
  render: () => <Siblings client={client} build={base} subject={id('button-primary')} go={go} />,
};

/** After the change, the nine unchanged stories kept no candidate. */
export const SiblingsKeptNoCandidate: Story = {
  parameters: { width: STAGE },
  render: () => <Siblings client={client} build={changed} subject={id('composed')} go={go} />,
};

const DS = 'cases/storybook-case/src/ds.jsx';

function region(
  kind: string,
  name: string,
  [startLine, endLine]: readonly [number, number],
  entered: readonly string[],
  observers: readonly string[],
): JourneyRegionRecord {
  return { kind, name, startLine, endLine, entered, missed: observers.filter((one) => !entered.includes(one)) };
}

const POOL = ['button-primary', 'button-secondary', 'card-rebranded', 'card-with-actions', 'composed', 'deferred', 'suspense-settles', 'revealed'].map(id);
const BUTTONED = ['button-primary', 'button-secondary', 'card-rebranded', 'card-with-actions', 'composed'].map(id);
const CARDED = ['card-rebranded', 'card-with-actions', 'composed'].map(id);
const PRIMARY = ['button-primary', 'card-rebranded', 'card-with-actions', 'composed'].map(id);

/** The journal the case would leave: stories of one component parting in `ds.jsx` where they render different parts of it. */
const PARTED: JourneysReport = {
  commit: changed.commit,
  whole: POOL,
  truncated: [id('ticking')],
  unrecorded: [id('loading')],
  found: [
    {
      file: DS,
      observers: POOL,
      parted: [
        region('function', 'Button', [51, 69], BUTTONED, POOL),
        region('branch', 'Button', [60, 60], PRIMARY, POOL),
        region('function', 'Card', [75, 90], CARDED, POOL),
        region('function', 'Disclosure', [146, 163], [id('revealed')], POOL),
        region('handler', 'Disclosure/onClick', [151, 151], [id('revealed')], POOL),
        region('function', 'Rows', [216, 230], [id('suspense-settles')], POOL),
        region('function', 'SuspendedRoster', [239, 257], [id('suspense-settles')], POOL),
        region('function', 'AsyncPanel', [297, 320], [id('deferred')], POOL),
        region('continuation', 'AsyncPanel/useEffect', [300, 303], [id('deferred')], POOL),
      ],
      unentered: [
        region('function', 'Spinner', [98, 115], [], POOL),
        region('function', 'SheetLeak', [344, 350], [], POOL),
      ],
    },
  ],
};

/** Two button stories that took one path through every module they share. */
const AGREED: JourneysReport = {
  commit: changed.commit,
  whole: [id('button-primary'), id('button-secondary')],
  truncated: [],
  unrecorded: [],
  found: [],
};

/** Only one story kept a complete journal. */
const ALONE: JourneysReport = {
  whole: [id('button-primary')],
  truncated: [id('ticking')],
  unrecorded: [],
  found: [],
};

const journeysOf = (journeys: JourneysReport): BuildDetail => ({ ...changed, journeys });

export const JourneysParted: Story = {
  parameters: { width: RUN },
  render: () => card(<JourneysPanel build={journeysOf(PARTED)} />),
};

export const JourneysAgreed: Story = {
  parameters: { width: RUN },
  render: () => card(<JourneysPanel build={journeysOf(AGREED)} />),
};

export const JourneysPoolOfOne: Story = {
  parameters: { width: RUN },
  render: () => card(<JourneysPanel build={journeysOf(ALONE)} />),
};

const SUSPENSE = ['suspense-settles', 'suspense-stalled', 'suspense-waterfall'].map(id);

/** The three suspense stories: one fork where the roster's rows render, one where the waterfall's invoice does. */
const SUSPENDED: JourneysReport = {
  commit: changed.commit,
  whole: SUSPENSE,
  truncated: [],
  unrecorded: [],
  found: [
    {
      file: DS,
      observers: SUSPENSE,
      parted: [
        region('function', 'Rows', [216, 230], [id('suspense-settles'), id('suspense-waterfall')], SUSPENSE),
        region('function', 'SuspendedRoster', [239, 257], [id('suspense-settles')], SUSPENSE),
        region('function', 'Invoice', [259, 271], [id('suspense-waterfall')], SUSPENSE),
        region('function', 'SuspendedWaterfall', [273, 280], [id('suspense-waterfall')], SUSPENSE),
        region('function', 'Stalled', [283, 286], [id('suspense-stalled')], SUSPENSE),
        region('function', 'StalledFeed', [289, 295], [id('suspense-stalled')], SUSPENSE),
      ],
      unentered: [],
    },
  ],
};

function drawn(journeys: JourneysReport): ReactElement {
  const [family] = familiesOf(journeys, []);
  if (family === undefined) throw new Error('the journal holds no family');
  const tree = treeOf(family, 8);
  return <Timeline family={family} forks={tree.forks.slice(0, 8)} tree={tree} />;
}

export const TimelineSuspense: Story = {
  parameters: { width: RUN },
  render: () => card(drawn(SUSPENDED)),
};

const BUILDS = [{ at: { page: 'builds' } as const, say: 'Builds' }];

/** The message `createReviewClient` throws for a service that answered 503. */
const UNAVAILABLE = 'GET /review/builds/ci-102 answered 503: "the review database is not reachable"';

export const FailureRetry: Story = {
  parameters: { width: OPENING },
  render: () => <Failure why={UNAVAILABLE} retry={go} />,
};

/** A recorded sentence with an identifier in it. */
export const ProseWithCode: Story = {
  parameters: { width: OPENING },
  render: () => (
    <p className="va-said">
      <Prose text={changed.notObserved[0]?.because ?? ''} /> — <Prose text={PAIRS[0]?.because ?? ''} />
    </p>
  ),
};

export const GoLink: Story = {
  parameters: { width: OPENING },
  render: () => (
    <p>
      <Go to={{ page: 'run', build: CHANGED }} go={go} className="va-mode">
        The run
      </Go>{' '}
      <Go to={{ page: 'subject', build: CHANGED, subject: id('composed') }} go={go}>
        {id('composed')}
      </Go>
    </p>
  ),
};

/** The docket's bar over the changed build. */
export const TopbarBuild: Story = {
  parameters: { width: 1248 },
  render: () => (
    <Topbar crumbs={BUILDS} go={go} title={`Build ${changed.build}`} subtitle={changed.project}>
      <span className="va-pill va-warn">{changed.pending} awaiting review</span>
      <span className="va-topbar-meta">
        <code className="va-commit">{changed.commit.slice(0, 8)}</code>
        {changed.branch === undefined ? null : <span>{changed.branch}</span>}
        <span>{changed.identity.engine}</span>
        <Go to={{ page: 'run', build: changed.build }} go={go} className="va-mode">
          The run
        </Go>
      </span>
    </Topbar>
  ),
};

export const TopbarBare: Story = {
  parameters: { width: 1248 },
  render: () => <Topbar crumbs={[]} go={go} title="Variance Authority" subtitle={base.project} />,
};

export const SkeletonBars: Story = {
  parameters: { width: OPENING },
  render: () => <Skeleton bars={3} label="Loading the changelog" />,
};

export const WaitingBuild: Story = {
  parameters: { page: true },
  render: () => <Waiting crumbs={BUILDS} go={go} title={`Build ${CHANGED}`} bars={5} />,
};

export const StalledBuild: Story = {
  parameters: { page: true },
  render: () => <Stalled crumbs={BUILDS} go={go} title={`Build ${CHANGED}`} why={UNAVAILABLE} retry={go} />,
};

export const NowherePage: Story = {
  parameters: { page: true },
  render: () => <Nowhere go={go} />,
};

export const MarkGlyph: Story = {
  parameters: { width: 120 },
  render: () => <Mark />,
};
