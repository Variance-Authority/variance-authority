/**
 * The comparison itself: the bar over it, the plate under it, and the seam.
 *
 * Its own module because it is the half of the sheet that is *about the
 * evidence* rather than about the room the evidence is read in. Every other rule
 * in {@link REVIEW_STYLES} decides where a sentence sits; these decide whether a
 * two-pixel shift is a two-pixel shift when a reviewer looks at it — the plate
 * does not smooth, the layers do not stretch to each other's dimensions, and the
 * region boxes sit at the coordinates the run measured rather than at
 * coordinates a layout arrived at. A rule in this block that is wrong makes the
 * page lie about a picture, which is not true of anything outside it.
 *
 * Concatenated into that sheet rather than shipped separately: the operator is
 * handed one string, and a consumer who had to remember to inject a second one
 * would have a page whose captions are styled and whose evidence is not.
 */
export const STAGE_STYLES = `
/* The bar over the stage: what is being compared, how large it is drawn, and
   which finding is being looked at. Three groups rather than one row of
   everything, because they are asked in that order and answered independently. */
.va-viewer-bar { display: grid; gap: 0.45rem; margin: 0.85rem 0 0.6rem; }
.va-viewer-controls, .va-viewer-readout { align-items: center; display: flex; flex-wrap: wrap; gap: 0.5rem; min-width: 0; }
.va-modes, .va-zooms { background: var(--va-sunken); border-radius: 9px; display: inline-flex; flex-wrap: wrap; gap: 0.15rem; padding: 0.2rem; }
.va-mode { background: none; border: 1px solid transparent; border-radius: 7px; font-family: var(--va-mono); font-size: 0.72rem; letter-spacing: 0.08em; padding: 0.25rem 0.6rem; text-transform: uppercase; white-space: nowrap; }
.va-mode.va-current { background: var(--va-accent-soft); border-color: var(--va-accent); color: var(--va-accent); font-weight: 650; }
.va-steps { align-items: center; display: inline-flex; gap: 0.4rem; margin-left: auto; }
.va-steps button { font-size: 0.9rem; line-height: 1; padding: 0.25rem 0.55rem; }
.va-steps span { color: var(--va-ink-3); font-family: var(--va-mono); font-size: 0.75rem; }

/* The stage is the pane; the plate is the capture inside it, at whatever
   magnification was asked for. Two boxes rather than one, because a zoom that
   grew the pane would push the decision buttons off the screen — the thing a
   reviewer came here to press. */
.va-loupe { background: var(--va-sunken); border: 1px solid var(--va-line); border-radius: 10px; max-height: 70vh; max-width: 100%; overflow: auto; overscroll-behavior: contain; position: relative; }
.va-plate { background: var(--va-surface); margin: 0 auto; position: relative; width: 100%; }
/* Every layer fills the plate, so the baseline and the candidate are always at
   one magnification. A wipe between two scales is not a comparison — it reads as
   a change everywhere the seam happens to fall. height: auto, because a deferred
   raster carries its own dimensions as attributes and a width alone would keep
   the declared height, squashing every candidate to the aspect ratio of nothing. */
.va-plate img { display: block; height: auto; image-rendering: pixelated; width: 100%; }
/* The baseline sits under the candidate at the corner rather than inset: 0 —
   stretched between top and bottom it would be drawn at the candidate's height
   whenever the two differ, which is often the change itself. */
.va-plate .va-under { left: 0; position: absolute; top: 0; }
/* Both layers leave the flow the moment the two captures are different shapes:
   the plate's height then comes from the union it declares, not from whichever
   image happens to be in flow — which would crop the taller one. */
.va-plate.va-boxed img { left: 0; position: absolute; top: 0; }
.va-measure { color: var(--va-ink-3); font-family: var(--va-mono); font-size: 0.72rem; margin: 0; }
.va-measure .va-resized { color: var(--va-accent); }
.va-showing { color: var(--va-ink-2); font-family: var(--va-mono); font-size: 0.72rem; margin: 0; }

/* The seam is the control, not a slider parked somewhere else on the page: it
   spans the plate, so the thumb sits over the boundary it moves, and it is a
   real range input, so it answers to the arrow keys as well as to a drag. */
.va-seam { -webkit-appearance: none; appearance: none; background: none; border: 0; border-radius: 0; display: block; height: 22px; margin-bottom: -22px; padding: 0; position: sticky; top: 0; width: 100%; z-index: 3; }
.va-seam::-webkit-slider-thumb { -webkit-appearance: none; background: var(--va-accent); border-radius: 2px; height: 22px; width: 4px; }
.va-seam::-moz-range-thumb { background: var(--va-accent); border: 0; border-radius: 2px; height: 22px; width: 4px; }
.va-seam-line { background: var(--va-accent); bottom: 0; pointer-events: none; position: absolute; top: 0; width: 1px; }
.va-blend { accent-color: var(--va-accent); display: block; margin-top: 0.6rem; width: 100%; }

.va-side-by-side { display: flex; gap: 1rem; }
.va-side-by-side figure { margin: 0; min-width: 0; }
.va-side-by-side figcaption { color: var(--va-ink-3); font-family: var(--va-mono); font-size: 0.68rem; letter-spacing: 0.09em; margin-bottom: 0.3rem; text-transform: uppercase; }
.va-side-by-side img { border: 1px solid var(--va-line); border-radius: 10px; height: auto; image-rendering: pixelated; max-width: 100%; }
.va-pixels { color: var(--va-ink-3); font-size: 0.82rem; margin-top: 0.5rem; }

.va-regions { inset: 0; pointer-events: none; position: absolute; }
.va-region { pointer-events: auto; position: absolute; }
.va-region.va-cause { outline: 2px solid var(--va-cause); }
.va-region.va-collateral { outline: 1px dashed var(--va-collateral); }
/* Lit from either side: the rectangle and its row are the same finding, and a
   reviewer joining them by counting down a table is doing the work twice. */
.va-region.va-lit { background: var(--va-accent-soft); outline-width: 3px; }
.va-region-label { background: var(--va-cause); border-radius: 3px; color: var(--va-accent-ink); font-family: var(--va-mono); font-size: 0.65rem; font-weight: 600; left: 0; padding: 0 0.25rem; position: absolute; top: -1.15rem; white-space: nowrap; }
.va-region.va-collateral .va-region-label { background: var(--va-collateral); color: var(--va-bg); }

/* The column a rectangle cannot draw. A box says *here*; only the table says
   which file to open, which is what lets a reviewer hand the change on rather
   than decide it themselves. */
.va-region-table { border-collapse: collapse; font-size: 0.82rem; margin-top: 0.75rem; width: 100%; }
.va-region-table th { border-bottom: 1px solid var(--va-line-firm); color: var(--va-ink-3); font-family: var(--va-mono); font-size: 0.65rem; font-weight: 600; letter-spacing: 0.09em; padding: 0.3rem 0.5rem; text-align: left; text-transform: uppercase; }
.va-region-table td { border-bottom: 1px solid var(--va-line); padding: 0.3rem 0.5rem; vertical-align: top; }
.va-region-table tr.va-lit td { background: var(--va-accent-soft); }
.va-region-table .va-num-col { text-align: right; }
.va-region-jump { align-items: baseline; background: none; border: 0; border-radius: 0; display: flex; gap: 0.4rem; padding: 0; text-align: left; }
.va-region-where { color: var(--va-ink-3); font-size: 0.75rem; }
.va-dot.va-cause { background: var(--va-cause); }
.va-dot.va-collateral { background: var(--va-collateral); }
`;
