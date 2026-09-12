/**
 * Looking at a change from the card that decides it.
 *
 * The docket answers *what moved and why*, and then offers two buttons. That is
 * one question short: a reviewer approving a restyle of `Button` across eleven
 * renders has been told the name of the component, the size of the difference and
 * the shape it repeats in, and has not been shown the difference. Sending them to
 * the full stage for that is sending them away from the decision — a route
 * capture is nine thousand pixels tall, the difference is a hundred and thirty
 * across, and finding it is a scroll they perform once per subject.
 *
 * So the change is brought to the card, cropped to where the run measured it.
 *
 * ## One crop per shape, not one per place
 *
 * The card's own argument is *one edit, N places*. A strip of eleven thumbnails
 * would contradict it in the same breath as making it, and would ask the browser
 * to decode eleven full-page captures to say a thing the fingerprints already
 * said. What is drawn instead is one crop per distinct shape, which is exactly
 * the set the card claims is redundant — if two of them look different, the claim
 * was wrong and the reviewer can see that it was.
 *
 * An appearance whose run recorded no shape is its own crop. Absent is not equal:
 * two differences nothing characterised have not been shown to match, and folding
 * them together would hide one behind a picture of the other.
 *
 * ## The difference is the first layer
 *
 * The strip opens on the mask the comparison drew. A crop of the candidate is a
 * picture of the component, and a reviewer reading one against a baseline they
 * remember is redoing by eye the comparison the run already did to the pixel. The
 * two readings are one press behind it and stay mounted once asked for, so moving
 * between the three is a repaint rather than a fetch.
 *
 * ## Deferred by the window, not by a button
 *
 * A route candidate here is 1280 × 9000 and costs about 46MB of bitmap to decode,
 * and a change with six shapes asks for six of them. That cost is why the strip
 * used to sit behind a *look at the change* button — which priced every difference
 * on the page at a click, and there is no reviewer who does not want to see the
 * difference. It also capped the strip at three, so a change with six shapes drew
 * half of itself and counted the rest.
 *
 * So the deferral moved to where the cost is. Each crop asks for its raster when
 * its own window comes near the viewport, and only for the layer being shown.
 * `loading="lazy"` cannot do that job here: the plate is the whole capture
 * translated so the region lands in a 264px window, which on a mobile route is a
 * 17,000px offset — the browser sees a box far outside the viewport and defers it
 * forever, leaving a red ring over an empty frame. What is watched instead is the
 * window, which is 264 × 176 and sitting exactly where the reviewer is looking.
 */

import { useCallback, useState, type CSSProperties, type ReactElement } from 'react';
import type { RegionRecord } from '@variance-authority/report';
import type { ReviewClient } from './client.js';
import type { Appearance } from './grouping.js';
import { hasDifference, useDifferenceUrl } from './difference.js';
import { leadOf } from './lead.js';
import { count, number } from './text.js';
import { share, union, type Size } from './viewer.js';

/**
 * The crop window, in CSS pixels.
 *
 * Fixed, and the same for every crop in a strip. Sizing each window to its own
 * region would make the strip a bar chart of region areas, which is the ranking
 * by area this whole surface exists to refuse — and it would do it in the one
 * place a reviewer reads as *how big is this change*.
 */
const WINDOW: Size = { width: 264, height: 176 };

/** Source pixels kept around the region, so the difference has a page to be on. */
const PAD = 20;

/**
 * How far the crop may be pushed, in either direction.
 *
 * Below 1:1 a two-pixel shift is handed to the resampler, which is the whole
 * reason the sheet refuses smoothing — but a region larger than the window has to
 * come down or it is not a picture of anything, so the floor is a quarter rather
 * than one, and {@link Frame.whole} says which of the two happened.
 */
const FURTHEST = 0.25;
const CLOSEST = 8;

/**
 * The three readings, in the order they are offered and preferred.
 *
 * `diff` first because it is the answer rather than the evidence for it. The
 * names are the stage's, so a reviewer who opens the full render finds the same
 * three words on the same three things.
 */
type Layer = 'diff' | 'after' | 'before';

const LAYERS: readonly Layer[] = ['diff', 'after', 'before'];

const SAY: Readonly<Record<Layer, string>> = {
  diff: 'difference',
  after: 'this build',
  before: 'baseline',
};

/** Where the plate sits inside the window, and at what magnification. */
export interface Frame {
  readonly scale: number;
  /** The plate's offset inside the window, in CSS pixels. Usually negative. */
  readonly left: number;
  readonly top: number;
  /** `false` when the region is bigger than the window even pushed all the way out. */
  readonly whole: boolean;
}

/**
 * The magnification and offset that put one region in the middle of the window.
 *
 * The clamp on the second axis is what keeps the crop a picture rather than a
 * coordinate: a region near the top of a capture, centred honestly, would put
 * half the window above the first row of the image, and a reviewer would be
 * looking at a difference with a band of nothing over it. So the plate is allowed
 * to be off-centre when the region is near an edge, and is centred outright when
 * the whole capture is smaller than the window — which is most stories.
 */
export function frameOf(region: RegionRecord, box: Size, window: Size): Frame {
  const wanted = Math.min(
    window.width / (region.width + PAD * 2),
    window.height / (region.height + PAD * 2),
  );
  const scale = Math.min(CLOSEST, Math.max(FURTHEST, wanted));

  return {
    scale,
    left: place(region.x + region.width / 2, box.width, window.width, scale),
    top: place(region.y + region.height / 2, box.height, window.height, scale),
    whole: region.width * scale <= window.width && region.height * scale <= window.height,
  };
}

/** One axis of {@link frameOf}: centre on the region, then refuse to leave the plate. */
function place(centre: number, extent: number, window: number, scale: number): number {
  const drawn = extent * scale;
  if (drawn <= window) return (window - drawn) / 2;
  return Math.min(0, Math.max(window - drawn, window / 2 - centre * scale));
}

/** One difference worth drawing, and how many places carry the same one. */
export interface Sighting {
  readonly appearance: Appearance;
  readonly at: RegionRecord;
  /** Places carrying this exact shape. `1` when the run recorded none. */
  readonly shared: number;
}

/**
 * Which of the appearances get a picture.
 *
 * Report order within a shape, so the crop shown is the one the docket lists
 * first rather than the biggest — the same rule the leading cause is chosen by,
 * and for the same reason: largest-first names the container that reflowed.
 */
export function sightings(appearances: readonly Appearance[]): readonly Sighting[] {
  const seen = new Set<string>();
  const found: Sighting[] = [];

  for (const appearance of appearances) {
    const at = leadOf(appearance.subject);
    if (at === undefined) continue;
    if (appearance.shape !== undefined) {
      if (seen.has(appearance.shape)) continue;
      seen.add(appearance.shape);
    }
    found.push({
      appearance,
      at,
      shared:
        appearance.shape === undefined
          ? 1
          : appearances.filter((each) => each.shape === appearance.shape).length,
    });
  }

  return found;
}

/**
 * The strip, and the one control on it.
 *
 * The switch is card-level rather than per crop, because the question a reviewer
 * asks is *did all of these move the same way* and answering it means moving them
 * together. A layer that has been asked for once stays mounted and switches
 * opacity, so returning to it does not go through a frame of nothing — a flash
 * reads as a third state, and on a difference of twenty pixels it is the loudest
 * thing on screen.
 */
export function Look({
  client,
  build,
  component,
  appearances,
  onOpen,
}: {
  readonly client: ReviewClient;
  readonly build: string;
  readonly component: string;
  readonly appearances: readonly Appearance[];
  readonly onOpen?: ((subject: string) => void) | undefined;
}): ReactElement | null {
  // Every layer ever asked for, most recent first. A list rather than one
  // selection: what is showing and what is loaded are different questions, and
  // unmounting the layer somebody just left is how a flip becomes a fetch.
  const [asked, setAsked] = useState<readonly Layer[]>([]);

  const found = sightings(appearances).filter(({ appearance }) =>
    LAYERS.some((layer) => appearance.subject.has[layer]),
  );

  const offered = LAYERS.filter((layer) =>
    found.some(({ appearance }) => appearance.subject.has[layer]),
  );
  const first = offered[0];
  if (first === undefined) return null;

  const showing = asked[0] ?? first;
  const mounted = new Set<Layer>([first, ...asked]);
  const look = (layer: Layer): void =>
    setAsked((was) => [layer, ...was.filter((each) => each !== layer)]);

  return (
    <>
      {offered.length === 1 ? null : (
        <p className="va-origin-look">
          <span className="va-modes">
            {offered.map((layer) => (
              <button
                key={layer}
                type="button"
                className={layer === showing ? 'va-mode va-current' : 'va-mode'}
                aria-pressed={layer === showing}
                onClick={() => look(layer)}
              >
                {SAY[layer]}
              </button>
            ))}
          </span>
        </p>
      )}

      <div className="va-look">
        {found.map((sighting) => (
          <Sighted
            key={sighting.appearance.subject.subject}
            client={client}
            build={build}
            component={component}
            sighting={sighting}
            showing={showing}
            mounted={mounted}
            onOpen={onOpen}
          />
        ))}
      </div>
    </>
  );
}

/** One crop, its caption, and the click that opens the whole render. */
function Sighted({
  client,
  build,
  component,
  sighting,
  showing,
  mounted,
  onOpen,
}: {
  readonly client: ReviewClient;
  readonly build: string;
  readonly component: string;
  readonly sighting: Sighting;
  readonly showing: Layer;
  readonly mounted: ReadonlySet<Layer>;
  readonly onOpen?: ((subject: string) => void) | undefined;
}): ReactElement {
  const { appearance, at, shared } = sighting;
  const subject = appearance.subject;

  const body = (
    <Crop
      client={client}
      build={build}
      subject={subject}
      at={at}
      showing={showing}
      mounted={mounted}
    />
  );

  const caption = (
    <span className="va-sight-note">
      {subject.subject} · {number(appearance.pixels)} px
      {shared === 1 ? '' : ` · ${count(shared, 'place')}`}
    </span>
  );

  if (onOpen === undefined) {
    return (
      <span className="va-sight">
        {body}
        {caption}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="va-sight"
      onClick={() => onOpen(subject.subject)}
      title={`Open ${subject.subject} — ${component} at ${number(at.x)}, ${number(at.y)}`}
    >
      {body}
      {caption}
    </button>
  );
}

/**
 * Whether this crop's window has come near the viewport.
 *
 * A renderer without the observer is told yes at once. A deferral nothing can
 * lift is a permanently empty frame, which is the exact failure `loading="lazy"`
 * had here — and a static render has no scroll to wait for.
 */
function useSeen(): readonly [(node: HTMLSpanElement | null) => (() => void) | undefined, boolean] {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');

  const watch = useCallback((node: HTMLSpanElement | null) => {
    if (node === null || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      // A screen ahead of the scroll, so the crop is decoded by the time it is
      // reached rather than arriving after it.
      { rootMargin: '600px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [watch, seen];
}

/**
 * The readings that have been asked for, at one magnification, region ringed.
 *
 * The layers are placed exactly as the stage places them — each at its own share
 * of the union box — because that is the one part of this that is easy to get
 * wrong invisibly. A baseline stretched to the candidate's width turns a width
 * change into a hairline, and at 3× on a 130-pixel region the hairline is off
 * screen entirely. The mask is the exception and needs no share: the comparison
 * drew it on the box it padded both captures to.
 */
function Crop({
  client,
  build,
  subject,
  at,
  showing,
  mounted,
}: {
  readonly client: ReviewClient;
  readonly build: string;
  readonly subject: Appearance['subject'];
  readonly at: RegionRecord;
  readonly showing: Layer;
  readonly mounted: ReadonlySet<Layer>;
}): ReactElement {
  const [watch, seen] = useSeen();
  // Only once the crop is mounting the mask: a strip of renders nobody switched
  // to `diff` decodes nothing. See [`difference.ts`](./difference.js).
  const difference = useDifferenceUrl(client, build, subject, mounted.has('diff'));
  const box = union(subject.size, subject.baseline);

  /** What this render can show at all, and where its bytes come from. */
  const shown = (layer: Layer): boolean =>
    layer === 'diff' ? hasDifference(subject) : subject.has[layer];
  const srcOf = (layer: Layer): string | undefined =>
    layer === 'diff' ? difference : client.imageUrl(build, subject.subject, layer);

  if (box === undefined) {
    return (
      <span className="va-crop va-crop-unplaced" style={boxOf(WINDOW)}>
        <span className="va-note">This run did not record the capture&rsquo;s size.</span>
      </span>
    );
  }

  // Said rather than drawn empty. The switch is card-level, so a render the run
  // kept no baseline for is asked for one, and a blank window under a red ring
  // reads as a difference nobody can see rather than an image nobody kept.
  if (!shown(showing)) {
    return (
      <span className="va-crop va-crop-unplaced" style={boxOf(WINDOW)}>
        <span className="va-note">No {SAY[showing]} was kept for this render.</span>
      </span>
    );
  }

  const frame = frameOf(at, box, WINDOW);
  const plate: CSSProperties = {
    height: `${String(box.height * frame.scale)}px`,
    left: `${String(frame.left)}px`,
    top: `${String(frame.top)}px`,
    width: `${String(box.width * frame.scale)}px`,
  };

  return (
    <span className="va-crop" style={boxOf(WINDOW)} ref={watch}>
      <span className="va-crop-plate" style={plate}>
        {seen
          ? LAYERS.filter(
              (layer) => mounted.has(layer) && shown(layer) && srcOf(layer) !== undefined,
            ).map((layer) => (
              <img
                key={layer}
                src={srcOf(layer)}
                alt=""
                decoding="async"
                style={{ ...spread(layer, subject, box), opacity: layer === showing ? 1 : 0 }}
              />
            ))
          : null}
        <span
          className="va-crop-box"
          style={{
            height: `${String((at.height / box.height) * 100)}%`,
            left: `${String((at.x / box.width) * 100)}%`,
            top: `${String((at.y / box.height) * 100)}%`,
            width: `${String((at.width / box.width) * 100)}%`,
          }}
        />
      </span>
      {frame.whole ? null : <span className="va-crop-part">part of it</span>}
    </span>
  );
}

/** One layer's share of the plate. The mask already spans it; the readings may not. */
function spread(
  layer: Layer,
  subject: Appearance['subject'],
  box: Size,
): CSSProperties | undefined {
  if (layer === 'diff') return undefined;
  return share(layer === 'after' ? subject.size : subject.baseline, box);
}

/** The window's own dimensions, written where a stylesheet cannot know them. */
function boxOf(window: Size): CSSProperties {
  return { height: `${String(window.height)}px`, width: `${String(window.width)}px` };
}
