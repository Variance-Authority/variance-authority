/**
 * The change page and every reading printed on it, over the recorded `Button`
 * change in `ci-102`.
 *
 * Each piece is photographed on its own at the centre stage's width, so a style
 * that moves one sentence of the page moves the image of that sentence rather
 * than a full page nobody can read a diff of. Where the recording reads one way
 * only — it carried no diff, no history and no second change — the state is
 * made by spreading the recorded object and overriding the fields that state is
 * about, and each one says so.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import type { BuildDetail, ReachView, SubjectView } from '../src/review-types.js';
import { AlsoCarries, carriedWith } from '../src/ui/carried.js';
import { ChangePanel } from '../src/ui/change.js';
import {
  Arrival,
  Collateral,
  Declared,
  Evidence,
  Recurrence,
  Shapes,
  SinceLast,
  Tally,
} from '../src/ui/change-story.js';
import type { ReviewClient } from '../src/ui/client.js';
import { Consumers, consumersOf } from '../src/ui/consumers.js';
import { HeldStill, controlsFor } from '../src/ui/control.js';
import { useCrossing, type Crossing } from '../src/ui/crossing.js';
import { DivergenceOf, DivergencePanel } from '../src/ui/divergence.js';
import { originsOf, type Origin } from '../src/ui/grouping.js';
import { Impact } from '../src/ui/impact.js';
import { movedElsewhere } from '../src/ui/sense.js';
import { BASE, CHANGED, buildOf, replayClient, replayed, subjectOf } from './replay.js';

const client = replayClient();
const changed = buildOf(CHANGED);
const base = buildOf(BASE);
const go = (): void => {};
const decided = (): void => {};

function originOf(build: BuildDetail, component = 'Button'): Origin {
  const found = originsOf(build).origins.find((each) => each.component === component);
  if (found === undefined) throw new Error(`${build.build} groups no change under ${component}`);
  return found;
}

const button = originOf(changed);
const changes = new Set(originsOf(changed).origins.map((each) => each.component));
const file = button.file ?? '';
const source = file.replace(/:\d+$/, '');

function subjects(build: BuildDetail, change: (subject: SubjectView) => SubjectView): BuildDetail {
  return { ...build, subjects: build.subjects.map(change) };
}

const endsIn = (subject: SubjectView, endings: readonly string[]): boolean =>
  endings.some((ending) => subject.subject.endsWith(ending));

/** `component`'s own content moving in these renders, where the recording has it only pushed. */
function moving(component: string, endings: readonly string[]): BuildDetail {
  return subjects(changed, (subject) =>
    endsIn(subject, endings) && subject.moved !== undefined
      ? {
          ...subject,
          moved: subject.moved.map((each) =>
            each.component === component ? { ...each, cause: true } : each,
          ),
        }
      : subject,
  );
}

/** Renders compared against a baseline that kept no component hashes. */
function unhashed(endings: readonly string[]): BuildDetail {
  return subjects(changed, (subject) => {
    if (!endsIn(subject, endings)) return subject;
    const { moved: _, ...rest } = subject;
    return rest;
  });
}

const approval = subjectOf(CHANGED, 'button-primary').decision;

// Every render of the change decided, which the recording leaves three short of.
const settled = subjects(changed, (subject) =>
  subject.verdict === 'changed' && subject.decision === null ? { ...subject, decision: approval } : subject,
);

// ci-102's own readings standing as ci-101's: the run before carried the same
// differences, with the decisions ci-102 recorded.
const repeated: BuildDetail = {
  ...changed,
  build: BASE,
  commit: base.commit,
  at: base.at,
  previous: null,
  ...(base.branch === undefined ? {} : { branch: base.branch }),
};

// As above, except card-rebranded did not move there and button-secondary moved
// the way button-primary did.
const primary = subjectOf(CHANGED, 'button-primary');
const mixed = subjects(repeated, (subject) => {
  if (subject.subject.endsWith('card-rebranded')) {
    return { ...subject, verdict: 'unchanged', changedPixels: 0, regions: [], decision: null };
  }
  if (subject.subject.endsWith('button-secondary')) {
    return { ...subject, changedPixels: primary.changedPixels, regions: primary.regions };
  }
  return subject;
});

/** The replay client, with the run before `ci-102` answered by `earlier`. */
function before(earlier: BuildDetail): ReviewClient {
  return { ...client, build: async (id) => (id === BASE ? earlier : client.build(id)) };
}

const again = before(repeated);
const partly = before(mixed);

/** The crossing as the page computes it, handed to whatever reads it. */
function Against({
  asked,
  build,
  draw,
}: {
  readonly asked: ReviewClient;
  readonly build: BuildDetail;
  readonly draw: (crossing: Crossing) => ReactElement | null;
}): ReactElement | null {
  return draw(useCrossing(asked, build));
}

const meta = {
  title: 'Tribunal/Change',
  parameters: { width: 760 },
  play: replayed,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const story = (render: () => ReactElement): Story => ({ render });

const panel = (build: BuildDetail, asked: ReviewClient = client): Story =>
  story(() => (
    <Against
      asked={asked}
      build={build}
      draw={(crossing) => (
        <ChangePanel
          client={client}
          reviewer="marina"
          build={build}
          origin={originOf(build)}
          crossing={crossing}
          changes={changes}
          go={go}
          onDecided={decided}
        />
      )}
    />
  ));

export const ChangePartlyDecided = panel(changed);
export const ChangeSeenBefore = panel(changed, again);
export const ChangeAllDecided = panel(settled);
export const ChangeCarryingAnother = panel(moving('Card', ['card-rebranded', 'composed']));

const tally = (origin: Origin): Story =>
  story(() => (
    <Tally
      origin={origin}
      elsewhere={
        movedElsewhere(
          origin.component,
          changed.subjects,
          new Set(origin.appearances.map(({ subject }) => subject.subject)),
        ).length
      }
      open={
        origin.appearances.filter(({ subject }) => subject.decision === null && subject.approvable)
          .length
      }
    />
  ));

export const TallyOpen = tally(button);
export const TallyNothingLeft = tally(originOf(settled));
// No render recorded a shape.
export const TallyNoShape = tally({
  ...button,
  appearances: button.appearances.map(({ shape: _, ...rest }) => rest),
});

export const DeclaredInFile = story(() => <Declared file={file} sourced />);
export const DeclaredOutsideTheSource = story(() => <Declared sourced />);
export const DeclaredNoSourceIndex = story(() => <Declared sourced={false} />);

const renders = button.appearances.map(({ subject }) => subject.subject);

// Arrival reads a diff, and the recorded run read none: each state is the reach
// it would have printed.
export const ArrivalReached = story(() => (
  <Arrival origin={{ ...button, reached: true, trail: [source, 'Button'] }} />
));
export const ArrivalStranded = story(() => (
  <Arrival origin={{ ...button, reached: false, stranded: renders, through: [], unlisted: [] }} />
));
export const ArrivalUnlisted = story(() => (
  <Arrival origin={{ ...button, reached: false, stranded: [], through: [], unlisted: renders }} />
));
export const ArrivalOutsideTheGraph = story(() => {
  const { cause: _, ...uncaused } = button;
  return (
    <Arrival
      origin={{ ...uncaused, reached: false, stranded: [], through: ['Card', 'Stack'], unlisted: [] }}
    />
  );
});

const since = (asked: ReviewClient): Story =>
  story(() => (
    <Against
      asked={asked}
      build={changed}
      draw={(crossing) => <SinceLast crossing={crossing} origin={button} />}
    />
  ));

export const SinceLastSameDifference = since(again);
export const SinceLastMovedDifferently = since(partly);

export const ShapesParted = story(() => <Shapes origin={button} />);
// Every render recording the same shape.
export const ShapesOneShape = story(() => (
  <Shapes
    origin={{
      ...button,
      appearances: button.appearances.map((each) => ({ ...each, shape: button.appearances[0]?.shape ?? '' })),
    }}
  />
));
// Two renders recording no shape.
export const ShapesSomeUnshaped = story(() => (
  <Shapes
    origin={{
      ...button,
      appearances: button.appearances.map((each, index) => {
        if (index < 3) return each;
        const { shape: _, ...rest } = each;
        return rest;
      }),
    }}
  />
));

// A history with runs in it; the recorded churn window holds none.
const recurring: ReviewClient = {
  ...client,
  churn: async (component) => ({
    ...(await client.churn(component)),
    runs: 12,
    changedRuns: 3,
    collateralRuns: 4,
    rejectedRuns: 1,
  }),
};

export const RecurrenceRecorded = story(() => <Recurrence client={recurring} component="Button" />);
export const CollateralCounted = story(() => <Collateral build={changed} />);
export const EvidenceFootnote = story(() => <Evidence />);

const carries = (build: BuildDetail): Story =>
  story(() => (
    <AlsoCarries
      carrying={carriedWith(build, 'Button', renders)}
      renders={renders.length}
      build={build.build}
      changes={new Set([...changes, 'Card'])}
      go={go}
    />
  ));

export const AlsoCarriesAnother = carries(moving('Card', ['card-rebranded', 'composed']));
export const AlsoCarriesUnread = carries(unhashed(['card-with-actions', 'composed']));

const consumers = (build: BuildDetail): Story =>
  story(() => (
    <Consumers
      found={consumersOf(build)('Button')}
      build={build.build}
      changes={new Set([...changes, 'Stack'])}
      go={go}
    />
  ));

export const ConsumersPushed = consumers(changed);
export const ConsumersMovedOnTheirOwn = consumers(moving('Stack', ['card-with-actions', 'composed']));
export const ConsumersUnread = consumers(unhashed(['card-rebranded', 'card-with-actions', 'composed']));

export const HeldNowhere = story(() => (
  <HeldStill controls={controlsFor(button)} build={CHANGED} go={go} />
));
// A render of Button under the same props read and unmoved, which this suite
// has none of.
export const HeldStillIn = story(() => (
  <HeldStill
    controls={controlsFor({
      ...button,
      appearances: button.appearances.map((each, index) =>
        index > 1 || each.movement === undefined
          ? each
          : { ...each, movement: { ...each.movement, held: ['story:case-surface--loading'] } },
      ),
    })}
    build={CHANGED}
    go={go}
  />
));

const impact = (build: BuildDetail): Story =>
  story(() => (
    <Against asked={client} build={build} draw={(crossing) => <Impact build={build} crossing={crossing} />} />
  ));

// The diff the recorded run would have read had it been given `--against main`.
const read: ReachView = {
  against: 'main',
  changed: [source],
  components: ['Button', 'Card', 'Stack', 'Tokens'].map((component) => ({
    component,
    trail: [source, component],
  })),
};

export const ImpactNoDiffRead = impact(changed);
export const ImpactDiffRead = impact({ ...changed, reach: read });
// A diff that reaches Card and not the Button that moved.
export const ImpactMovedOutsideTheDiff = impact({
  ...changed,
  reach: {
    ...read,
    changed: ['cases/storybook-case/src/card.stories.jsx'],
    components: [{ component: 'Card', trail: ['cases/storybook-case/src/card.stories.jsx', source, 'Card'] }],
  },
});
// A diff the run read and could not attribute.
export const ImpactDiffUnattributed = impact({
  ...changed,
  reach: { ...read, whole: 'the merge base is not in this clone, so the diff names every file' },
});

export const DivergenceFirstRun = story(() => <DivergencePanel client={client} build={base} />);
export const DivergenceNeverCompared = story(() => <DivergencePanel client={client} build={changed} />);
export const DivergenceSameAgain = story(() => <DivergencePanel client={again} build={changed} />);
export const DivergenceMixed = story(() => <DivergencePanel client={partly} build={changed} />);
// The service failing to answer for the run before.
export const DivergenceUnreadable = story(() => (
  <DivergenceOf
    crossing={{ state: 'failed', why: `GET /review/builds/${BASE} answered 503: "the store is unavailable"` }}
  />
));
