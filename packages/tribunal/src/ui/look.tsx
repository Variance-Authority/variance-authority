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
 * ## Revealed, not drawn on arrival
 *
 * A route candidate here is 1280 × 9000 and costs about 46MB of bitmap to decode.
 * Four cards, two layers, three crops each is a page that stalls before its first
 * row is readable — the cost [`viewer.tsx`](./viewer.tsx) defers with
 * `loading="lazy"` and that a 260px window does nothing to reduce, since the crop
 * magnifies the full raster rather than fetching a tile of it. The strip is
 * therefore behind a button, and the button is the sentence: *look at it*.
 */

import { useState, type CSSProperties, type ReactElement } from 'react';
import type { RegionRecord } from '@variance-authority/report';
import type { ReviewClient } from './client.js';
import type { Appearance } from './grouping.js';
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

/** How many shapes are drawn before the rest are counted instead. */
const SHOWN = 3;

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
 * The strip, and the one control that matters on it.
 *
 * The flip is card-level rather than per crop, because the question a reviewer
 * asks is *did all of these move the same way* and answering it means flipping
 * them together. Both layers stay mounted and the top one's opacity switches, so
 * the flip does not go through a frame of nothing — a flash reads as a third
 * state, and on a difference of twenty pixels it is the loudest thing on screen.
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
  const [open, setOpen] = useState(false);
  const [showing, setShowing] = useState<'before' | 'after'>('after');

  const found = sightings(appearances).filter(
    ({ appearance }) => appearance.subject.has.after || appearance.subject.has.before,
  );
  if (found.length === 0) return null;

  const drawn = found.slice(0, SHOWN);
  const flippable = drawn.some(({ appearance }) => appearance.subject.has.before);

  if (!open) {
    return (
      <p className="va-origin-look">
        <button type="button" className="va-mode" onClick={() => setOpen(true)}>
          Look at the change
        </button>
        <span className="va-note">
          {found.length === 1
            ? 'one difference, cropped to where it was measured'
            : `${count(found.length, 'distinct difference')}, cropped to where they were measured`}
        </span>
      </p>
    );
  }

  return (
    <>
      <p className="va-origin-look">
        <span className="va-note">
          Showing {showing === 'after' ? 'this build' : 'the baseline'}
          {drawn.length < found.length ? `, ${number(drawn.length)} of ${number(found.length)}` : ''}
        </span>
        {flippable ? (
          <button
            type="button"
            className="va-mode"
            onClick={() => setShowing((was) => (was === 'after' ? 'before' : 'after'))}
          >
            show {showing === 'after' ? 'the baseline' : 'this build'}
          </button>
        ) : null}
        <button type="button" className="va-mode" onClick={() => setOpen(false)}>
          hide
        </button>
      </p>

      <div className="va-look">
        {drawn.map((sighting) => (
          <Sighted
            key={sighting.appearance.subject.subject}
            client={client}
            build={build}
            component={component}
            sighting={sighting}
            showing={showing}
            onOpen={onOpen}
          />
        ))}
      </div>

      {drawn.length < found.length ? (
        <p className="va-note">
          {count(found.length - drawn.length, 'further shape')} under this change — open a subject
          from the list to see one.
        </p>
      ) : null}
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
  onOpen,
}: {
  readonly client: ReviewClient;
  readonly build: string;
  readonly component: string;
  readonly sighting: Sighting;
  readonly showing: 'before' | 'after';
  readonly onOpen?: ((subject: string) => void) | undefined;
}): ReactElement {
  const { appearance, at, shared } = sighting;
  const subject = appearance.subject;
  const box = union(subject.size, subject.baseline);

  const caption = (
    <span className="va-sight-note">
      {subject.subject} · {number(appearance.pixels)} px
      {shared === 1 ? '' : ` · ${count(shared, 'place')}`}
    </span>
  );

  const body =
    box === undefined ? (
      <span className="va-crop va-crop-unplaced" style={boxOf(WINDOW)}>
        <span className="va-note">This run did not record the capture&rsquo;s size.</span>
      </span>
    ) : (
      <Crop client={client} build={build} subject={subject} at={at} box={box} showing={showing} />
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
 * Both readings, at one magnification, with the measured region ringed.
 *
 * The layers are placed exactly as the stage places them — each at its own share
 * of the union box — because that is the one part of this that is easy to get
 * wrong invisibly. A baseline stretched to the candidate's width turns a width
 * change into a hairline, and at 3× on a 130-pixel region the hairline is off
 * screen entirely.
 *
 * Nothing here is `loading="lazy"`, and that is the point rather than an
 * oversight. The plate is the whole capture, translated so the region lands in a
 * 264px window — on a mobile route that is a 17,000px offset, which puts the
 * element's box far outside the viewport and leaves a lazy image deferred
 * forever. The crop drew an empty frame with a red ring on it and looked like a
 * picture of a difference nobody could see. The deferral this file argues for is
 * the reveal: nothing is requested until somebody presses the button.
 */
function Crop({
  client,
  build,
  subject,
  at,
  box,
  showing,
}: {
  readonly client: ReviewClient;
  readonly build: string;
  readonly subject: Appearance['subject'];
  readonly at: RegionRecord;
  readonly box: Size;
  readonly showing: 'before' | 'after';
}): ReactElement {
  const frame = frameOf(at, box, WINDOW);
  const url = (kind: 'before' | 'after'): string => client.imageUrl(build, subject.subject, kind);

  const plate: CSSProperties = {
    height: `${String(box.height * frame.scale)}px`,
    left: `${String(frame.left)}px`,
    top: `${String(frame.top)}px`,
    width: `${String(box.width * frame.scale)}px`,
  };

  return (
    <span className="va-crop" style={boxOf(WINDOW)}>
      <span className="va-crop-plate" style={plate}>
        {subject.has.before ? (
          <img
            className="va-under"
            src={url('before')}
            alt=""
            decoding="async"
            style={share(subject.baseline, box)}
          />
        ) : null}
        {subject.has.after ? (
          <img
            src={url('after')}
            alt=""
            decoding="async"
            style={{
              ...share(subject.size, box),
              // Mounted whichever way it is showing, so the flip is one repaint
              // and never a frame of the plate's own background.
              opacity: showing === 'after' || !subject.has.before ? 1 : 0,
            }}
          />
        ) : null}
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

/** The window's own dimensions, written where a stylesheet cannot know them. */
function boxOf(window: Size): CSSProperties {
  return { height: `${String(window.height)}px`, width: `${String(window.width)}px` };
}
