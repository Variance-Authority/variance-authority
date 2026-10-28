/**
 * The notes the review page writes beside a change: concerns, findings, the
 * declaration audit, the docket rail, what moved, why, and where it came from.
 *
 * Each sits in the box the page puts it in — the subject page's aside, the
 * docket's rail, the run page's card, the change page's column — because that
 * box's width is where its sentences wrap and its background is what its tags
 * are drawn against. Every value is the recorded build's; a state the recording
 * never reached is the recorded object with the fewest fields moved to reach it.
 */
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState, type ReactElement } from 'react';
import type { FindingRecord, IgnoreUsage, SensitivityUsage } from '@variance-authority/report';
import type { Concern, ConcernTally } from '../src/concern-types.js';
import type { BuildDetail, DecisionRecord, MovementView, SubjectView } from '../src/review-types.js';
import { BaselineMovedNotice } from '../src/ui/baseline-moved.js';
import { Because, Marked } from '../src/ui/because.js';
import { ConcernForm } from '../src/ui/concern-form.js';
import { ConcernTallyLine, ConcernTrail, Concerns, type Asked } from '../src/ui/concerns.js';
import { useCrossing } from '../src/ui/crossing.js';
import { DeclarationsPanel } from '../src/ui/declarations.js';
import { distanceFrom } from '../src/ui/distance.js';
import { Findings } from '../src/ui/findings.js';
import { originsOf, type Origin } from '../src/ui/grouping.js';
import { HandedTo, MovedElsewhere, MovedHere, MovedLead, WhatMoved } from '../src/ui/moved.js';
import { docketOf, type Group } from '../src/ui/order.js';
import { OriginsPanel } from '../src/ui/origins.js';
import { Repeated } from '../src/ui/repeated.js';
import { RootHeading, UnderRoot } from '../src/ui/root.js';
import type { Order } from '../src/ui/route.js';
import { movedElsewhere, senseAcross } from '../src/ui/sense.js';
import { BASE, buildOf, CHANGED, recorded, replayClient, replayed, subjectOf } from './replay.js';

const client = replayClient();
const go = (): void => {};
const changed = buildOf(CHANGED);
const base = buildOf(BASE);

function first<T>(all: readonly T[], what: string): T {
  const one = all[0];
  if (one === undefined) throw new Error(`the recording holds no ${what}`);
  return one;
}

const button = first(originsOf(changed).origins, 'change in ci-102');
const across = senseAcross(button.component, button.appearances);
const changes = new Set([button.component]);
const unread = first(docketOf(changed, originsOf(changed).origins, 'story'), 'docket band in ci-102');

const primary = subjectOf(CHANGED, 'story:case-surface--button-primary');
const secondary = subjectOf(CHANGED, 'story:case-surface--button-secondary');
const rebranded = subjectOf(CHANGED, 'story:case-surface--card-rebranded');
const composed = subjectOf(CHANGED, 'story:case-surface--composed');
const loading = subjectOf(CHANGED, 'story:case-surface--loading');

const raised = recorded<{ concerns: Concern[]; tally: ConcernTally }>(`/review/concerns?build=${CHANGED}`);
const concern = first(raised.concerns, 'concern');
const approved = primary.decision as DecisionRecord;
const rejected = secondary.decision as DecisionRecord;

/** The subject page's aside: a card on its sunken ground, 22rem wide. */
const aside =
  (heading: string): Decorator =>
  (Story) => (
    <aside className="va-aside">
      <section className="va-card">
        <h2>{heading}</h2>
        <Story />
      </section>
    </aside>
  );

/** The docket's rail, 21rem wide. */
const rail: Decorator = (Story) => (
  <nav className="va-rail">
    <Story />
  </nav>
);

/** A card in the centre column, as the run page draws one. */
const card =
  (heading: string): Decorator =>
  (Story) => (
    <section className="va-card">
      <h2>{heading}</h2>
      <Story />
    </section>
  );

/** The change page's column. */
const decide: Decorator = (Story) => (
  <div className="va-decide">
    <Story />
  </div>
);

const ASIDE = { width: 384 };
const RAIL = { width: 368 };
const STAGE = { width: 760 };

const meta = { title: 'Tribunal/Notes', play: replayed } satisfies Meta;

export default meta;
type Story = StoryObj;

type Render = () => ReactElement;
const side = (heading: string, render: Render): Story => ({ render, parameters: ASIDE, decorators: [aside(heading)] });
const inRail = (render: Render): Story => ({ render, parameters: RAIL, decorators: [rail] });
const inCard = (heading: string, render: Render): Story => ({ render, parameters: STAGE, decorators: [card(heading)] });
const column = (render: Render): Story => ({ render, parameters: STAGE, decorators: [decide] });
const bare = (render: Render): Story => ({ render, parameters: STAGE });

/* --- concerns ------------------------------------------------------------ */

export const ConcernsRaised = side('Concerns', () => <Concerns client={client} reviewer="marina" build={CHANGED} subject={rebranded} />);

export const ConcernsUnflagged = side('Concerns', () => <Concerns client={client} reviewer="marina" build={CHANGED} subject={composed} />);

// The bar asked for the form after the card mounted, as Investigate does.
function AskedLater(): ReactElement {
  const [asked, setAsked] = useState<Asked | undefined>(undefined);
  useEffect(() => setAsked({ state: 'investigating', seq: 1 }), []);
  return <Concerns client={client} reviewer="marina" build={CHANGED} subject={rebranded} asked={asked} />;
}

export const ConcernsWritingBesideTrail = side('Concerns', () => <AskedLater />);

export const ConcernTrailOpen = side('Concerns', () => <ConcernTrail concern={concern} build={CHANGED} busy={false} onMove={go} />);

const pay = first(rebranded.regions, 'region on card-rebranded');

// Under investigation: a second reviewer took it and pinned it to the button's region.
const investigating: Concern = {
  ...concern,
  state: 'investigating',
  region: { x: pay.x, y: pay.y, width: pay.width, height: pay.height, component: 'Button' },
  evidence: ['Button', 'cases/storybook-case/src/ds.jsx:53'],
  events: [...concern.events, { state: 'investigating', by: 'anton', at: rejected.at, note: 'Reproduced at 375px.' }],
};

export const ConcernTrailInvestigating = side('Concerns', () => <ConcernTrail concern={investigating} build={CHANGED} busy={false} onMove={go} />);

// Resolved: the investigation closed it.
const resolved: Concern = {
  ...investigating,
  state: 'resolved',
  events: [...investigating.events, { state: 'resolved', by: 'anton', at: approved.at, note: 'Intended: the card follows its content.' }],
};

export const ConcernTrailResolved = side('Concerns', () => <ConcernTrail concern={resolved} build={CHANGED} busy={false} onMove={go} />);

export const ConcernTallyCounted = bare(() => <ConcernTallyLine tally={raised.tally} />);

export const ConcernTallyUnread = bare(() => <ConcernTallyLine tally="Failed to fetch" />);

export const ConcernFormOnRegions = side('Concerns', () => <ConcernForm subject={composed} build={CHANGED} reviewer="marina" busy={false} onSave={go} onCancel={go} />);

export const ConcernFormWholeRender = side('Concerns', () => (
  <ConcernForm
    subject={loading}
    build={CHANGED}
    reviewer="marina"
    busy={false}
    initial="investigating"
    onSave={go}
    onCancel={go}
  />
));

/* --- findings ------------------------------------------------------------ */

const { findings: _inspected, ...uninspected } = composed;

function finding(region: SubjectView['regions'][number], over: Partial<FindingRecord>): FindingRecord {
  return {
    rule: 'overflows-container',
    band: 'geometry',
    what: 'the button reaches past the right edge of the card that contains it',
    path: region.path ?? '0',
    ...(region.where === undefined ? {} : { where: region.where }),
    ...(region.component === undefined ? {} : { component: region.component }),
    ...(region.file === undefined ? {} : { file: region.file }),
    ...over,
  };
}

const [payWide = pay, payTall = pay] = composed.regions;
const nested = { rule: 'nested-interactive', band: 'a11y', standing: true, what: 'a button is nested inside another control; only one of the two is reachable' };

// Inspected: the padding change pushed the button out of its card.
const arrived = { ...composed, findings: [finding(payWide, { standing: false })] };

// Inspected: that, and a defect the baseline already carried, in two places.
const carried = {
  ...composed,
  findings: [finding(payWide, { standing: false }), finding(payWide, nested), finding(payTall, { ...nested, path: '0/0/0/0/2/0' })],
};

// Inspected by a run that kept no baseline findings, so neither one is dated.
const undated = { ...composed, findings: carried.findings.slice(1).map(({ standing: _standing, ...each }) => each) };

export const FindingsNotInspected = side('Findings', () => <Findings subject={uninspected} />);
export const FindingsClean = side('Findings', () => <Findings subject={composed} />);
export const FindingsArrived = side('Findings', () => <Findings subject={arrived} />);
export const FindingsArrivedAndCarried = side('Findings', () => <Findings subject={carried} />);
export const FindingsUndated = side('Findings', () => <Findings subject={undated} />);

/* --- declarations -------------------------------------------------------- */

const deferred = subjectOf(CHANGED, 'story:case-surface--deferred').subject;
const receipt = subjectOf(CHANGED, 'story:case-surface--receipt-at-two-widths@375').subject;

const ignore = (rule: string, reason: string, over: Partial<IgnoreUsage>): IgnoreUsage => ({
  rule,
  reason,
  pixels: 0,
  subjects: 1,
  comparedIn: 1,
  inertIn: 1,
  unresolved: false,
  unwornTags: [],
  expired: false,
  ...over,
});

const sensitivity = (rule: string, reason: string, over: Partial<SensitivityUsage>): SensitivityUsage => ({
  rule,
  reason,
  level: 'layout',
  scoped: 2,
  absorbed: [],
  bands: [],
  unscoped: false,
  ...over,
});

// A run whose config declared ignores: one working, one dead, one untested, one on a tag nobody wears.
const ignored: BuildDetail['declarations'] = {
  ...changed.declarations,
  ignores: {
    rules: [
      ignore('clock', 'the header clock ticks', { pixels: 412, inertIn: 0 }),
      ignore('promo-banner', 'the banner rotates weekly', { subjects: 3, comparedIn: 3, inertIn: 3 }),
      ignore('legacy-receipt', 'the old receipt is being replaced', { subjects: 2, comparedIn: 0, inertIn: 0 }),
      ignore('checkout-only', 'checkout totals are live', { subjects: 0, comparedIn: 0, inertIn: 0, unwornTags: ['checkout'] }),
    ],
    dead: ['promo-banner'],
    fullyIgnored: [deferred],
    totalPixels: 412,
    vocabulary: ['no-variance'],
  },
};

// A run whose config declared sensitivities: one that decided a verdict, one that decided none, one whose bands were not kept.
const relaxed: BuildDetail['declarations'] = {
  ...changed.declarations,
  sensitivities: {
    rules: [
      sensitivity('receipt-copy', 'receipt copy is edited weekly', { absorbed: [receipt], bands: ['content'] }),
      sensitivity('card-shadows', 'shadow tokens are in flux', { level: 'structure', scoped: 4 }),
      sensitivity('suspense-fallbacks', 'fallbacks settle at their own pace', { absorbed: [receipt] }),
    ],
    totalAbsorbed: 2,
  },
};

export const DeclarationsNoLedger = inCard('Declarations', () => <DeclarationsPanel declarations={changed.declarations} />);
export const DeclarationsIgnores = inCard('Declarations', () => <DeclarationsPanel declarations={ignored} />);
export const DeclarationsSensitivities = inCard('Declarations', () => <DeclarationsPanel declarations={relaxed} />);

/* --- the docket rail ----------------------------------------------------- */

function Rail({ build, order, selected }: { build: BuildDetail; order: Order; selected?: string }): ReactElement {
  return <OriginsPanel build={build} crossing={useCrossing(client, build)} order={order} selected={selected} go={go} />;
}

export const OriginsDocket = inRail(() => <Rail build={changed} order="story" />);
export const OriginsSelected = inRail(() => <Rail build={changed} order="size" selected="Button" />);
export const OriginsFirstRun = inRail(() => <Rail build={base} order="story" />);

/* --- where it came from -------------------------------------------------- */

// Rooted: the run read a diff, and the docket band hangs from the file it named.
const file = { kind: 'file', name: 'cases/storybook-case/src/ds.jsx', changes: unread.changes, renders: button.appearances.length } as const;
const fromFile: Group = { ...unread, lane: 'reached', title: 'Edited', root: file };

// Rooted in a custom property the commit gave a new value.
const fromToken: Group = { ...unread, lane: 'token', title: 'Token moved', root: { ...file, kind: 'token', name: '--button-padding' } };

// The same file moved a second change, so the heading names its sibling.
const cardChange: Origin = { ...button, component: 'Card', file: 'cases/storybook-case/src/ds.jsx:21', appearances: button.appearances.slice(2) };
const withSibling: Group = { ...fromFile, changes: [...fromFile.changes, { origin: cardChange }] };

export const RootHeadingUnread = inRail(() => <RootHeading group={unread} detail={changed} go={go} />);
export const RootHeadingFile = inRail(() => <RootHeading group={fromFile} detail={changed} go={go} />);
export const RootHeadingToken = inRail(() => <RootHeading group={fromToken} detail={changed} go={go} />);

const under = (bands: readonly Group[]) => () => (
  <UnderRoot bands={bands} component="Button" declared={button.file} build={CHANGED} go={go} />
);

export const UnderRootFile = column(under([fromFile]));
export const UnderRootWithSibling = column(under([withSibling]));

/* --- what moved ---------------------------------------------------------- */

export const MovedLeadOwnBands = column(() => <MovedLead component="Button" across={across} handed={[]} />);

// Every band Button moved in belongs to the card that draws it.
const handed = across.bands.map((band) => ({ band, holders: ['Card'], moved: 3, held: 2 }));

export const MovedLeadHandedAway = column(() => <MovedLead component="Button" across={across} handed={handed} />);

// Collateral: a region named Button, and Button's own hashes held still.
export const MovedLeadPushed = column(() => <MovedLead component="Button" across={{ ...across, bands: [] }} handed={[]} />);

// The geometry Button moved in is decided by Card, which is a change on this build, and by Stack, which is not.
export const HandedToParents = column(() => (
  <HandedTo
    handed={[{ band: 'geometry', holders: ['Card', 'Stack'], moved: 3, held: 2 }]}
    build={CHANGED}
    changes={new Set(['Button', 'Card'])}
    go={go}
  />
));

export const WhatMovedAlongside = column(() => <WhatMoved component="Button" across={across} far={distanceFrom(changed, 'Button')} />);

// Two renders where no region carried Button, and one baseline with no hashes.
export const WhatMovedMissed = column(() => (
  <WhatMoved
    component="Button"
    across={{ ...across, missedIn: [rebranded.subject, composed.subject], unmeasured: [secondary.subject] }}
  />
));

export const MovedHereMeasured = side('What moved', () => <MovedHere subject={primary} anchor="Button" far={distanceFrom(changed, 'Button')} />);

export const MovedHereNotMeasured = side('What moved', () => <MovedHere subject={loading} />);

// Both revisions were read and every component hash matched.
export const MovedHereHashesMatched = side('What moved', () => <MovedHere subject={{ ...composed, moved: [] }} />);

// Only the two button stories are on this page, so the three cards are found elsewhere.
const elsewhere = movedElsewhere('Button', changed.subjects, new Set([primary.subject, secondary.subject])).map(
  (each, index) => (index === 0 ? { ...each, filedUnder: 'Card' } : index === 1 ? { ...each, drawn: false } : each),
);

export const MovedElsewhereFiled = side('Decision', () => <MovedElsewhere component="Button" found={elsewhere} build={CHANGED} go={go} />);

/* --- why ----------------------------------------------------------------- */

export const BecauseUnexplained = column(() => <Because origin={button} build={CHANGED} changes={changes} go={go} />);

const unstanding = ({ standing: _standing, ...movement }: MovementView): MovementView => movement;

// The run read a diff: Card was edited, and Button moved because Card draws it; one render had already failed to read twice.
const upstream: Origin = {
  ...button,
  appearances: button.appearances.map((appearance, index) =>
    appearance.movement === undefined
      ? appearance
      : {
          ...appearance,
          movement:
            index === 0
              ? { ...appearance.movement, standing: 'flake' }
              : {
                  ...unstanding(appearance.movement),
                  cause: 'upstream',
                  upstream: 'Card',
                  because: 'its owner `Card` was edited in `cases/storybook-case/src/ds.jsx`, and draws it',
                },
        },
  ),
};

export const BecauseUpstream = column(() => <Because origin={upstream} build={CHANGED} changes={new Set(['Button', 'Card'])} go={go} />);

export const MarkedCode = bare(() => (
  <p className="va-attributed">
    <Marked say={first(changed.movements, 'movement').because} />
  </p>
));

/* --- repeated, and a baseline that moved ---------------------------------- */

const keptIn = (decision: DecisionRecord | null, count = 1): SubjectView => ({
  ...rebranded,
  repeats: { count, builds: [{ build: BASE, at: base.at, decision }] },
});

// The image was kept by the build before, undecided there.
export const RepeatedUndecided = side('Decision', () => <Repeated subject={keptIn(null)} ran={changed.at} go={go} />);

// Kept and approved there, after this build ran; and kept by one build further back.
export const RepeatedApproved = side('Decision', () => <Repeated subject={keptIn(approved, 2)} ran={changed.at} go={go} />);

// Kept and approved there before this build ran, which still differs from its baseline.
export const RepeatedApprovedBefore = side('Decision', () => <Repeated subject={keptIn({ ...approved, at: base.at })} ran={changed.at} go={go} />);

export const RepeatedRejected = side('Decision', () => <Repeated subject={keptIn(rejected)} ran={changed.at} go={go} />);

// Refused: the baseline the page read was replaced, by a digest nothing recorded, while the reviewer looked.
const moved = { read: primary.baselineVersion ?? null, current: 'v1:7c1e04d2a9b35f60e8d1c4a7b2f9e013' };

export const BaselineMovedOnSubject = side('Decision', () => <BaselineMovedNotice moved={{ ...moved, read: null }} reload="Reload this subject" busy={false} onReload={go} />);

export const BaselineMovedInBatch = column(() => (
  <BaselineMovedNotice
    moved={{ ...moved, clash: `build "${BASE}" changed it at ${pay.x},${pay.y} ${pay.width}×${pay.height}, where this build changed it too` }}
    subject={rebranded.subject}
    reload="Reload this change"
    busy={false}
    onReload={go}
  />
));
