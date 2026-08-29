import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { SubjectView } from '../review.js';
import type { ReviewClient } from './client.js';
import { RegionOverlay, RegionTable } from './regions.js';
import { count, magnitude, number } from './text.js';

/**
 * Looking at the change: the stage, the modes, and the zoom that makes any of it
 * mean anything.
 *
 * Apart from [`review.tsx`](./review.tsx) because the two answer different
 * questions and are read in that order. The docket decides *what is worth looking
 * at* and is the part of this surface that refuses the category's habit;
 * everything here is the looking itself, and is reached only once that question
 * has been answered.
 *
 * Three positions this file exists to hold:
 *
 * **Every layer is drawn at one scale.** The plate has a width and each raster
 * fills it, so the baseline and the candidate are always the same magnification.
 * A wipe between two images at different scales is not a comparison; it is two
 * pictures with a line between them, and it reads as a change everywhere the line
 * happens to be.
 *
 * **Fit-to-width is a starting position, not the only one.** A route capture is
 * 1280 pixels wide and arrives in a pane about half that, so a two-pixel shift is
 * drawn at one pixel — under the resampler, which is to say not drawn. The whole
 * reason the sheet refuses smoothing is so that a reviewer can go to 1:1 and see
 * two pixels; without a zoom that refusal protects nothing.
 *
 * **A reviewer is taken to the finding.** The run measured where the differences
 * are. On nine thousand pixels of route, asking somebody to scroll until they
 * notice one is asking them to redo the measurement by eye — so the regions are
 * a list you step through, and the stage scrolls to each.
 */

export type ViewerMode = 'regions' | 'wipe' | 'blend' | 'blink' | 'side-by-side' | 'difference';

/** `'fit'` scales the plate to the pane; a number is that multiple of 1:1. */
type Zoom = 'fit' | 1 | 2 | 4;

const ZOOMS: readonly Zoom[] = ['fit', 1, 2, 4];

/**
 * What each mode is called on the button.
 *
 * The union members are identifiers and two of them read as identifiers. A
 * reviewer is not debugging this surface; nothing on it should ask them to
 * translate.
 */
const LABELS: Readonly<Record<ViewerMode, string>> = {
  regions: 'regions',
  wipe: 'wipe',
  blend: 'blend',
  blink: 'blink',
  'side-by-side': 'side by side',
  difference: 'difference',
};

/** A raster's own pixels — never a rendered size, which the zoom decides. */
type Size = { readonly width: number; readonly height: number };

/** Long enough to read either state, short enough that the eye holds both. */
const BLINK_MS = 700;

export function Viewer({
  client,
  build,
  subject,
}: {
  readonly client: ReviewClient;
  readonly build: string;
  readonly subject: SubjectView;
}): ReactElement {
  const available = useMemo(() => modesFor(subject), [subject]);
  const [mode, setMode] = useState<ViewerMode>(available[0] ?? 'regions');
  const [seam, setSeam] = useState(50);
  const [blend, setBlend] = useState(50);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [focus, setFocus] = useState<number | null>(null);
  const [flip, setFlip] = useState(true);
  const [pull, setPull] = useState(0);
  const [still] = useState(calm);
  const stage = useRef<HTMLDivElement>(null);

  /**
   * The frame both readings are drawn in.
   *
   * The union of the two captures, which is what the comparison itself measured
   * in — it pads to the union box, so the regions are already in these
   * coordinates. Drawing each image at its own share of this box is the whole
   * point: a baseline stretched to the candidate's width is a width change
   * resampled into a hairline, and a width change is one of the largest things
   * that can happen to a page.
   */
  const box = union(subject.size, subject.baseline);

  // The alternation, driven here rather than by a keyframe: the stylesheet is
  // pasted into somebody else's page and is held to hiding nothing, and a reader
  // who never chose this mode should not have an animation running in it.
  useEffect(() => {
    if (mode !== 'blink' || still) return;
    const timer = setInterval(() => setFlip((was) => !was), BLINK_MS);
    return () => clearInterval(timer);
  }, [mode, still]);

  // What survives the move to another subject and what does not. Mode and
  // magnification are the reviewer's; a region number belongs to the picture it
  // was counted in, and a mode this subject cannot make would render a frame with
  // no image behind it.
  useEffect(() => {
    setFocus(null);
    setPull(0);
    setMode((was) => (available.includes(was) ? was : (available[0] ?? 'regions')));
    stage.current?.scrollTo({ left: 0, top: 0 });
  }, [available]);

  useEffect(() => {
    if (pull === 0 || focus === null) return;
    const region = subject.regions[focus];
    const pane = stage.current;
    if (region === undefined || pane === null) return;
    const at = zoom === 'fit' ? 1 : zoom;
    pane.scrollTo({
      left: Math.max(0, (region.x + region.width / 2) * at - pane.clientWidth / 2),
      top: Math.max(0, (region.y + region.height / 2) * at - pane.clientHeight / 2),
      behavior: still ? 'auto' : 'smooth',
    });
    // Deliberately keyed on the count alone: two jumps to the same region are two
    // requests, and the zoom this reads is already the one the plate was drawn at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pull]);

  // Every hook is above this line, and has to be: without a `key` forcing a
  // remount, moving from a subject with images to one without would otherwise
  // change how many hooks this component calls.
  if (available.length === 0) {
    return <p className="va-note">This run kept no images for this subject.</p>;
  }

  const size = subject.size;
  const url = (kind: 'before' | 'after' | 'diff'): string =>
    client.imageUrl(build, subject.subject, kind);

  /**
   * Centre a region in the pane.
   *
   * At fit the plate is smaller than the capture and there is nothing to scroll
   * to, so this raises the zoom first — the request is *show me this*, and
   * showing it at a third of size is answering a different question.
   *
   * The scroll itself is deferred to the effect below rather than done here.
   * Raising the zoom changes the plate's height, and a scroll issued against the
   * old height is clamped to it: from fit to 1:1 the plate shrinks by whatever the
   * pane was scaling it, and the pane lands short of the region by that factor.
   */
  const jump = (index: number): void => {
    if (subject.regions[index] === undefined || box === undefined) return;
    setFocus(index);
    if (zoom === 'fit') setZoom(1);
    setPull((count) => count + 1);
  };

  const zoomable = box !== undefined;
  /**
   * Fit is a ceiling rather than a stretch. A 390-wide capture in a 700-wide pane
   * has nothing to gain from being drawn at 700: the run refuses smoothing, so the
   * only thing an upscale adds is blocks the render never had. Below its own width
   * the plate shrinks to the pane; at or above it, it stops.
   *
   * The ratio is declared rather than left to the images, because the images are
   * taken out of flow the moment there are two of them at different sizes — and a
   * plate with no height is a plate the region boxes have nothing to sit on.
   */
  const plate: CSSProperties =
    box === undefined
      ? {}
      : {
          aspectRatio: `${String(box.width)} / ${String(box.height)}`,
          ...(zoom === 'fit'
            ? { maxWidth: `${String(box.width)}px` }
            : { width: `${String(box.width * zoom)}px` }),
        };
  const boxes =
    mode === 'side-by-side' ? null : (
      <RegionOverlay subject={subject} box={box} focus={focus} onFocus={setFocus} />
    );

  return (
    <div className="va-viewer">
      <div className="va-viewer-bar">
        <div className="va-viewer-controls">
          <p className="va-modes">
            {available.map((option) => (
              <button
                key={option}
                type="button"
                className={option === mode ? 'va-mode va-current' : 'va-mode'}
                aria-pressed={option === mode}
                onClick={() => setMode(option)}
              >
                {LABELS[option]}
              </button>
            ))}
          </p>
          {zoomable ? (
            <p className="va-zooms">
              {ZOOMS.map((option) => (
                <button
                  key={String(option)}
                  type="button"
                  className={option === zoom ? 'va-mode va-current' : 'va-mode'}
                  aria-pressed={option === zoom}
                  onClick={() => setZoom(option)}
                >
                  {option === 'fit' ? 'fit' : `${String(option)}×`}
                </button>
              ))}
            </p>
          ) : null}
        </div>
        <div className="va-viewer-readout">
          <p className="va-showing">{showing(mode, { seam, blend, flip })}</p>
          {size === undefined ? null : (
            <p className="va-measure" title="the candidate’s own pixels, which 1× draws one for one">
              {number(size.width)} × {number(size.height)}
              {subject.baseline === undefined ||
              (subject.baseline.width === size.width &&
                subject.baseline.height === size.height) ? (
                ''
              ) : (
                <span className="va-resized">
                  {' '}
                  · was {number(subject.baseline.width)} × {number(subject.baseline.height)}
                </span>
              )}
            </p>
          )}
          {subject.regions.length > 0 ? (
            <p className="va-steps">
              <button type="button" onClick={() => jump(step(focus, subject.regions.length, -1))}>
                ‹
              </button>
              <span className="va-num">
                {focus === null ? '—' : String(focus + 1)} / {String(subject.regions.length)}
              </span>
              <button type="button" onClick={() => jump(step(focus, subject.regions.length, 1))}>
                ›
              </button>
            </p>
          ) : null}
        </div>
      </div>

      {mode === 'side-by-side' ? (
        <div className="va-side-by-side">
          <figure>
            <figcaption>baseline</figcaption>
            <Raster src={url('before')} alt={`${subject.subject} baseline`} />
          </figure>
          <figure>
            <figcaption>this build</figcaption>
            <Raster src={url('after')} alt={`${subject.subject} candidate`} size={size} />
          </figure>
        </div>
      ) : (
        <div className="va-loupe" ref={stage}>
          <div className={box === undefined ? 'va-plate' : 'va-plate va-boxed'} style={plate}>
            {mode === 'wipe' ? (
              <input
                type="range"
                className="va-seam"
                min={0}
                max={100}
                value={seam}
                aria-label="wipe between baseline and candidate"
                onChange={(event) => setSeam(Number(event.target.value))}
              />
            ) : null}
            {mode === 'difference' ? (
              // Already in the union's coordinates: the mask is what the
              // comparison drew, on the box it padded both captures to.
              <Raster src={url('diff')} alt={`${subject.subject} difference mask`} />
            ) : (
              <>
                {subject.has.before ? (
                  <Raster
                    className="va-under"
                    src={url('before')}
                    alt={`${subject.subject} baseline`}
                    style={share(subject.baseline, box)}
                  />
                ) : null}
                <Raster
                  src={url('after')}
                  alt={`${subject.subject} candidate`}
                  size={size}
                  style={{ ...share(size, box), ...over(mode, { seam, blend, flip }) }}
                />
              </>
            )}
            {boxes}
            {mode === 'wipe' ? (
              <span className="va-seam-line" aria-hidden="true" style={{ left: `${String(seam)}%` }} />
            ) : null}
          </div>
        </div>
      )}

      {mode === 'blink' && still ? (
        <p className="va-note">
          This display asked for reduced motion, so the two readings do not alternate on their
          own.{' '}
          <button type="button" className="va-mode" onClick={() => setFlip((was) => !was)}>
            show {flip ? 'the baseline' : 'this build'}
          </button>
        </p>
      ) : null}

      {mode === 'blend' ? (
        <input
          type="range"
          className="va-blend"
          min={0}
          max={100}
          value={blend}
          aria-label="fade between baseline and candidate"
          onChange={(event) => setBlend(Number(event.target.value))}
        />
      ) : null}

      <p className="va-pixels">
        {magnitude(subject)}
        {subject.truncated === undefined ? null : (
          <>
            {' '}
            · {count(subject.truncated.regions, 'further region')} ({number(
              subject.truncated.pixels,
            )}px) were not recorded
          </>
        )}
        {subject.missingFonts === undefined || subject.missingFonts.length === 0 ? null : (
          <> · fonts missing at render: {subject.missingFonts.join(', ')}</>
        )}
      </p>

      <RegionTable subject={subject} focus={focus} onFocus={setFocus} onJump={jump} />
    </div>
  );
}

/**
 * How the candidate is revealed, given the mode.
 *
 * One layer and one declaration, rather than a wrapper that clips: a clip path
 * moves the seam without changing the box, so the candidate keeps its own height
 * whatever the baseline underneath rendered to — which is frequently the change.
 */
function over(
  mode: ViewerMode,
  at: { readonly seam: number; readonly blend: number; readonly flip: boolean },
): CSSProperties {
  if (mode === 'wipe') return { clipPath: `inset(0 0 0 ${String(at.seam)}%)` };
  if (mode === 'blend') return { opacity: at.blend / 100 };
  if (mode === 'blink') return { opacity: at.flip ? 1 : 0 };
  return {};
}

/** The box that contains both captures, when either of them is known. */
function union(
  candidate: Size | undefined,
  baseline: Size | undefined,
): Size | undefined {
  if (candidate === undefined) return baseline;
  if (baseline === undefined) return candidate;
  return {
    width: Math.max(candidate.width, baseline.width),
    height: Math.max(candidate.height, baseline.height),
  };
}

/**
 * One layer's share of the plate, as a percentage.
 *
 * A percentage rather than a pixel width so that nothing here has to know the
 * magnification: the plate is sized once and every layer scales with it. Absent
 * when this layer's own size was never recorded, which leaves the stylesheet's
 * `width: 100%` — the old behaviour, and the honest one, since a layer nobody
 * measured cannot be placed against one that was.
 */
function share(own: Size | undefined, box: Size | undefined): CSSProperties | undefined {
  if (own === undefined || box === undefined || own.width === box.width) return undefined;
  return { width: `${String((own.width / box.width) * 100)}%` };
}

/**
 * Whether this display has asked for less movement.
 *
 * Read once, at mount, so a render is consistent with itself; `matchMedia` is
 * absent in a static render, where there is no interval and no scroll to suppress
 * and the answer is therefore no. What it governs is not decoration — blink *is*
 * the alternation — so the mode is not withdrawn, it is handed over to the
 * reviewer to step.
 */
function calm(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Which reading is on screen, said in the bar where a reviewer is looking. */
function showing(
  mode: ViewerMode,
  at: { readonly seam: number; readonly blend: number; readonly flip: boolean },
): string {
  if (mode === 'wipe') return `baseline ◀ ${String(Math.round(at.seam))}% ▶ this build`;
  if (mode === 'blend') return `${String(Math.round(at.blend))}% this build`;
  if (mode === 'blink') return at.flip ? 'this build' : 'baseline';
  if (mode === 'difference') return 'difference mask';
  return 'this build';
}

/** The next region to visit, wrapping, from nothing at either end. */
function step(focus: number | null, total: number, by: 1 | -1): number {
  if (focus === null) return by === 1 ? 0 : total - 1;
  return (focus + by + total) % total;
}

/**
 * One stored raster, fetched when it is about to be looked at.
 *
 * `loading="lazy"`, because a build page is a docket of every subject and a
 * reviewer reads one at a time. A route suite's candidates are full-page: this
 * project's four routes come to nine thousand pixels of height each, and twenty
 * of them decoded at once is tens of thousands of rows of bitmap in one document
 * — enough to stall the renderer before the first row of the table can be read.
 * Nothing above the fold needs any of them.
 *
 * `size` reserves the box before the bytes arrive, and is passed only where the
 * dimensions belong to *this* raster — the candidate. A baseline may have been a
 * different height (that is frequently the change), and a diff mask is not
 * measured at all, so those are deferred without a reservation rather than
 * reserved wrongly. A wrong reservation is worse than none: the page settles at
 * one height and then jumps.
 */
function Raster({
  src,
  alt,
  size,
  className,
  style,
}: {
  readonly src: string;
  readonly alt: string;
  readonly size?: { readonly width: number; readonly height: number } | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}): ReactElement {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      {...(size === undefined ? {} : { width: size.width, height: size.height })}
      {...(className === undefined ? {} : { className })}
      {...(style === undefined ? {} : { style })}
    />
  );
}

/**
 * Which comparisons this build can actually offer.
 *
 * Derived from what the run kept rather than offered unconditionally: a mode
 * whose image does not exist renders a broken frame, and a broken frame in a
 * review surface reads as a subject that renders to nothing.
 */
export function modesFor(subject: SubjectView): readonly ViewerMode[] {
  const modes: ViewerMode[] = [];
  if (subject.has.after && subject.size !== undefined && subject.regions.length > 0) {
    modes.push('regions');
  }
  if (subject.has.before && subject.has.after) {
    modes.push('wipe', 'blend', 'blink', 'side-by-side');
  }
  if (subject.has.diff) modes.push('difference');
  if (modes.length === 0 && subject.has.after) modes.push('regions');
  return modes;
}

export { RegionOverlay, RegionTable } from './regions.js';
