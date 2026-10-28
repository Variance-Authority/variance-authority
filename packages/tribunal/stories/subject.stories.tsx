/**
 * One render and the parts it is read through: the rail that picks it, the
 * stage and its boxes, the crop strip a change card carries, the column beside
 * the picture and the bar under it.
 *
 * Each over the recorded builds, at the width it has on the page, so a change to
 * the stylesheet or the layout of any of them moves a photograph here. A mode or
 * a layer a reviewer has to press for is pressed by the story's `play`, which
 * waits for the image that press brings before the story counts as drawn.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import type { RegionRecord } from '@variance-authority/report';
import type { SubjectView } from '../src/review-types.js';
import { ActionBar, type Place } from '../src/ui/action-bar.js';
import { createReviewClient, type ReviewClient } from '../src/ui/client.js';
import { distanceFrom } from '../src/ui/distance.js';
import { originsOf, type Appearance } from '../src/ui/grouping.js';
import { causeOf } from '../src/ui/lead.js';
import { Look } from '../src/ui/look.js';
import { Raster, share, union } from '../src/ui/plate.js';
import { queueOf, SubjectRail } from '../src/ui/rail.js';
import { RegionOverlay, RegionTable } from '../src/ui/regions.js';
import { needsReview } from '../src/ui/settled.js';
import { SubjectPanel } from '../src/ui/subject.js';
import { Viewer } from '../src/ui/viewer.js';
import { BASE, buildOf, CHANGED, replayClient, replayed, subjectOf } from './replay.js';

const client = replayClient();
/**
 * The replay, with every capture the page asks for by `fetch` answered as the
 * service answers an image the build did not keep. The `<img>` sources still
 * come from the recording, so only a mask the page computes fails.
 */
const refusing: ReviewClient = {
  ...client,
  imageBlob: createReviewClient({
    endpoint: 'https://tribunal.invalid',
    fetch: (async () =>
      Response.json({ error: 'this build kept no such image' }, { status: 404 })) as typeof globalThis.fetch,
  }).imageBlob,
};
const none = (): void => {};

const composed = subjectOf(CHANGED, 'story:case-surface--composed');
const primary = subjectOf(CHANGED, 'story:case-surface--button-primary');
const secondary = subjectOf(CHANGED, 'story:case-surface--button-secondary');
const rebranded = subjectOf(CHANGED, 'story:case-surface--card-rebranded');
const withActions = subjectOf(CHANGED, 'story:case-surface--card-with-actions');
const loading = subjectOf(CHANGED, 'story:case-surface--loading');
const first = subjectOf(BASE, 'story:case-surface--composed');

const meta = {
  title: 'Tribunal/Subject',
  play: replayed,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
type Play = NonNullable<Story['play']>;

const reviewable = (build: string): readonly SubjectView[] =>
  buildOf(build).subjects.filter((each) => needsReview(each.verdict));

/** Where a subject sits in the queue the build page's rail draws. */
function placeOf(build: string, subject: SubjectView): Place {
  const queue = queueOf(reviewable(build));
  const at = queue.indexOf(subject);
  return {
    ...(at < 0 ? {} : { at }),
    of: queue.length,
    previous: at > 0 ? queue[at - 1]?.subject : undefined,
    next: queue[at + 1]?.subject,
  };
}

/** Whether the run resolved any source file, as the build page decides it. */
const sourced = (build: string): boolean => buildOf(build).causes.some((cause) => cause.file !== undefined);

/**
 * Resolves once `enough` holds of `root`, asked again on every change under it,
 * without polling. Throws naming `what` if it still does not hold after five
 * seconds, so a page that never gets there fails its story, not the whole run.
 */
function when(root: HTMLElement, what: string, enough: () => boolean): Promise<void> {
  if (enough()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!enough()) return;
      observer.disconnect();
      clearTimeout(deadline);
      resolve();
    });
    const deadline = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`after five seconds, still waiting for ${what}`));
    }, 5_000);
    observer.observe(root, { attributes: true, characterData: true, childList: true, subtree: true });
  });
}

/**
 * Every image under `root` decoded, so the photograph is not of a frame mid-load.
 *
 * An image that will not decode fails the story, named by its `alt`, or its `src`
 * when it has none: its photograph would be of a broken frame, and would pass.
 */
const decoded: Play = async ({ canvasElement }) => {
  await replayed();
  const images = [...canvasElement.querySelectorAll('img')];
  const settled = await Promise.allSettled(images.map((img) => img.decode()));
  const broken = images.filter((_, index) => settled[index]?.status === 'rejected');
  if (broken.length > 0) {
    throw new Error(`these images did not decode: ${broken.map((img) => img.alt || img.src).join(', ')}`);
  }
};

/** Whether the toggle that reads `label` is the one pressed. */
const pressed = (root: HTMLElement, label: string): boolean =>
  [...root.querySelectorAll('[aria-pressed="true"]')].some((each) => each.textContent?.trim() === label);

/** Presses the button that reads `label`, as a reviewer would. */
function press(root: HTMLElement, label: string): void {
  const button = [...root.querySelectorAll('button')].find((each) => each.textContent?.trim() === label);
  if (button === undefined) throw new Error(`no button reads ${label}`);
  button.click();
}

const reading = (node: Element): boolean =>
  node.classList.contains('va-waiting') || (node.textContent?.trim().endsWith('…') ?? false);

const bar = (props: Partial<Parameters<typeof ActionBar>[0]> & { readonly subject: SubjectView }): Story => ({
  parameters: { width: 960 },
  render: () => (
    <ActionBar
      place={placeOf(CHANGED, props.subject)}
      busy={false}
      onDecide={none}
      onSuspect={none}
      onGo={none}
      {...props}
    />
  ),
});

export const ActionBarPending = bar({ subject: rebranded });
export const ActionBarFirstInQueue = bar({ subject: composed });
export const ActionBarDeciding = bar({ subject: rebranded, busy: true });
export const ActionBarWritingConcern = bar({ subject: rebranded, writing: true });
export const ActionBarNotInQueue = bar({ subject: loading });
export const ActionBarWithoutWayAlong = bar({ subject: rebranded, place: undefined, onGo: undefined });

const rail = (build: string, selected: string | null): Story => ({
  parameters: { width: 340 },
  render: () => (
    <nav className="va-rail">
      <SubjectRail
        subjects={reviewable(build)}
        causes={buildOf(build).causes.length}
        variations={buildOf(build).variations.length}
        selected={selected}
        onSelect={none}
      />
    </nav>
  ),
});

export const RailChanged = rail(CHANGED, composed.subject);
export const RailOnDocket = rail(CHANGED, null);
export const RailFirstRun = rail(BASE, first.subject);

const inMode =
  (label: string, wait: string): Play =>
  async (context) => {
    const root = context.canvasElement;
    press(root, label);
    await when(root, `${label} pressed and ${wait} drawn`, () => pressed(root, label) && root.querySelector(wait) !== null);
    await decoded(context);
  };

const view = (subject: SubjectView, play: Play = decoded, build = CHANGED, using = client): Story => ({
  parameters: { width: 760 },
  render: () => <Viewer client={using} build={build} subject={subject} sourced={sourced(build)} />,
  play,
});

export const ViewerRegions = view(composed);
export const ViewerWipe = view(composed, inMode('wipe', '.va-seam-line'));
export const ViewerSideBySide = view(composed, inMode('side by side', '.va-side-by-side img'));
export const ViewerDifference = view(composed, inMode('difference', 'img[alt$="difference mask"]'));
// The mask the page computes, from captures the service would not serve.
export const ViewerDifferenceRefused = view(
  composed,
  async (context) => {
    const root = context.canvasElement;
    press(root, 'difference');
    await when(root, 'the viewer saying why there is no mask', () =>
      [...root.querySelectorAll('.va-note')].some((note) => note.textContent?.includes('could not compute') ?? false),
    );
    await decoded(context);
  },
  CHANGED,
  refusing,
);
export const ViewerAtTwice = view(composed, inMode('2×', '.va-loupe img'));
export const ViewerNew = view(first, decoded, BASE);
export const ViewerNothingKept = view(loading);
// A run that capped its region list; the recording kept every region it found.
export const ViewerTruncated = view({ ...withActions, truncated: { regions: 4, pixels: 312 } });

/** The overlay on its plate, as the stage draws it at fit. */
function Plated({ subject, focus }: { readonly subject: SubjectView; readonly focus: number | null }): ReactElement {
  const box = union(subject.size, subject.baseline);
  return (
    <div
      className="va-plate va-boxed"
      style={
        box === undefined
          ? {}
          : { aspectRatio: `${String(box.width)} / ${String(box.height)}`, maxWidth: `${String(box.width)}px` }
      }
    >
      <Raster
        src={client.imageUrl(CHANGED, subject.subject, 'after')}
        alt={`${subject.subject} candidate`}
        size={subject.size}
        style={share(subject.size, box)}
      />
      <RegionOverlay subject={subject} box={box} focus={focus} />
    </div>
  );
}

const overlay = (subject: SubjectView, focus: number | null = null): Story => ({
  parameters: { width: 760 },
  render: () => <Plated subject={subject} focus={focus} />,
  play: decoded,
});

export const OverlayCauseAndCollateral = overlay(composed);
export const OverlayCollateralLit = overlay(
  composed,
  composed.regions.findIndex((region) => !region.cause),
);
export const OverlayOneCause = overlay(secondary);

const unfiled = ({ file: _file, ...rest }: RegionRecord): RegionRecord => rest;

const table = (subject: SubjectView, indexed: boolean, focus: number | null = null): Story => ({
  parameters: { width: 760 },
  render: () => <RegionTable subject={subject} sourced={indexed} focus={focus} onFocus={none} onJump={none} />,
});

export const TableSourced = table(composed, true);
export const TableRowLit = table(composed, true, 1);
// A region out of a dependency: named, but in no file the run's index declares.
export const TableNotInScannedSource = table(
  { ...composed, regions: composed.regions.map((region, index) => (index === 2 ? unfiled(region) : region)) },
  true,
);
// A run with no source index: no region carries a file, and one carries no name.
export const TableNoSourceIndex = table(
  {
    ...withActions,
    regions: withActions.regions.map((region, index) => {
      const { component, ...rest } = unfiled(region);
      return index === 1 ? rest : { ...rest, ...(component === undefined ? {} : { component }) };
    }),
  },
  false,
);

const button = originsOf(buildOf(CHANGED)).origins.find((origin) => origin.component === 'Button');
if (button === undefined) throw new Error(`${CHANGED} recorded no change in Button`);

/** Presses a layer, if any, then waits for every placed crop to show it. */
const onLayer =
  (label?: string): Play =>
  async (context) => {
    const root = context.canvasElement;
    if (label !== undefined) press(root, label);
    await when(root, `every placed crop showing ${label ?? 'its layer'}`, () => {
      const placed = [...root.querySelectorAll('.va-crop:not(.va-crop-unplaced)')];
      return (
        (label === undefined || pressed(root, label)) &&
        placed.length > 0 &&
        placed.every((crop) => [...crop.querySelectorAll('img')].some((img) => img.style.opacity === '1'))
      );
    });
    await decoded(context);
  };

const unbased = ({ baseline: _baseline, ...rest }: SubjectView): SubjectView => ({
  ...rest,
  has: { before: false, after: true, diff: false },
});

const strip = (
  appearances: readonly Appearance[],
  play: Play,
  openable = true,
  using: ReviewClient = client,
): Story => ({
  parameters: { width: 760 },
  render: () => (
    <Look
      client={using}
      build={CHANGED}
      component={button.component}
      appearances={appearances}
      onOpen={openable ? none : undefined}
    />
  ),
  play,
});

// Whatever layer the strip opens on, unpressed.
export const LookOpening = strip(button.appearances, onLayer());
export const LookThisBuild = strip(button.appearances, onLayer('this build'));
export const LookBaseline = strip(button.appearances, onLayer('baseline'));
// One render whose run kept no baseline, beside the ones that kept both.
export const LookNoBaselineKept = strip(
  button.appearances.map((each, index) => (index === 1 ? { ...each, subject: unbased(each.subject) } : each)),
  onLayer('baseline'),
);
export const LookNotOpenable = strip(button.appearances, onLayer('this build'), false);
// The strip opens on the difference, and every mask it computes is refused.
export const LookDifferenceRefused = strip(
  button.appearances,
  async (context) => {
    const root = context.canvasElement;
    await when(root, 'every crop saying its mask could not be computed', () => {
      const crops = [...root.querySelectorAll('.va-crop')];
      return (
        crops.length > 0 &&
        crops.every((crop) => crop.textContent?.includes('could not be computed') ?? false)
      );
    });
    await decoded(context);
  },
  true,
  refusing,
);

const raster = (kind: 'before' | 'after'): Story => ({
  parameters: { width: 380 },
  render: () => (
    <div className="va-plate">
      <Raster
        src={client.imageUrl(CHANGED, composed.subject, kind)}
        alt={`${composed.subject} ${kind === 'after' ? 'candidate' : 'baseline'}`}
        size={kind === 'after' ? composed.size : undefined}
      />
    </div>
  ),
  play: decoded,
});

export const RasterCandidate = raster('after');
export const RasterBaseline = raster('before');

const panel = (subject: SubjectView, build = CHANGED): Story => {
  const anchor = causeOf(subject);
  return {
    parameters: { width: 960 },
    render: () => (
      <SubjectPanel
        client={client}
        reviewer="marina"
        build={build}
        ran={buildOf(build).at}
        subject={subject}
        {...(anchor === undefined ? {} : { anchor, far: distanceFrom(buildOf(build), anchor) })}
        sourced={sourced(build)}
        place={placeOf(build, subject)}
        go={none}
        onGo={none}
        onDecided={none}
      />
    ),
    // The column reads concerns and the record on its own; a note still
    // saying *Reading…* is a panel photographed before it answered.
    play: async (context) => {
      const root = context.canvasElement;
      await when(root, 'every note answered', () => ![...root.querySelectorAll('.va-note, .va-waiting')].some(reading));
      await decoded(context);
    },
  };
};

export const PanelPending = panel(composed);
export const PanelApproved = panel(primary);
export const PanelRejected = panel(secondary);
export const PanelConcernRaised = panel(rebranded);
export const PanelUnchanged = panel(loading);
export const PanelNew = panel(first, BASE);
