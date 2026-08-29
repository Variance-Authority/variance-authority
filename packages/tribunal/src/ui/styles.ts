/**
 * The stylesheet, as a string the operator injects.
 *
 * Not imported, not bundled, not a CSS module and not a dependency on anybody's
 * build. A component library that ships a `.css` import decides the consumer's
 * toolchain for them; this one hands over text and lets them put it in a
 * `<style>` tag, a `layout.tsx`, or nowhere at all — the markup carries plain
 * class names and degrades to unstyled rather than to broken.
 *
 * Two rules here are load-bearing rather than decorative:
 *
 * **Cause and collateral are drawn differently.** A single highlight colour would
 * make the box that was edited and the box that merely reflowed look like the
 * same finding, which is precisely the mistake ranking by area makes.
 *
 * **Images render at their own pixel grid.** `image-rendering: pixelated` and no
 * smoothing, because a reviewer zooming into a 2px shift must see 2px and not an
 * interpolation of it.
 */
export const REVIEW_STYLES = `
.va-note { color: #666; font-size: 0.9rem; }
.va-failure { color: #a11; font-weight: 600; }

.va-builds { list-style: none; margin: 0; padding: 0; }
.va-build { border-bottom: 1px solid #e5e5e5; padding: 0.75rem 0; }
.va-build-open { background: none; border: 0; cursor: pointer; font: inherit; padding: 0; text-align: left; }
.va-build-id { font-weight: 600; }
.va-commit, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
.va-branch { color: #666; margin-left: 0.5rem; }

.va-verdicts { display: flex; gap: 1rem; margin: 0.25rem 0; }
.va-pending { color: #a56000; font-weight: 600; }
.va-settled { color: #2a7; }
.va-counts { color: #666; font-size: 0.9rem; }

.va-coverage { font-size: 0.9rem; margin: 0.25rem 0; }
.va-coverage.va-unknown { color: #a56000; }
.va-coverage.va-incomplete { color: #a11; font-weight: 600; }

.va-docket table { border-collapse: collapse; width: 100%; }
.va-docket th { text-align: left; font-weight: 600; border-bottom: 2px solid #333; padding: 0.25rem 0.5rem; }
.va-docket td { border-bottom: 1px solid #eee; padding: 0.25rem 0.5rem; }
.va-collateral { color: #666; font-size: 0.9rem; }

.va-variation-list { list-style: none; margin: 0; padding: 0; }
.va-variation { border-bottom: 1px solid #eee; padding: 0.5rem 0; }
.va-variation-head { margin: 0 0 0.15rem; }
/* Every chip carries its own text colour rather than inheriting the page's: the
   backgrounds are light in both schemes, and a chip that inherited a dark
   scheme's foreground would be pale text on a pale block. */
.va-axis { background: #e2e8f0; border-radius: 3px; color: #1e293b; font-size: 0.8rem; padding: 0.1rem 0.4rem; }
/* The two states a reviewer can act on, and they are not the same finding: an
   arm that changes nothing was measured, a pair with no parent never was. */
.va-variation.va-inert .va-axis { background: #fde8c8; color: #6b3d00; }
.va-variation.va-unlinked .va-axis { background: #f8d8d8; color: #7a1f1f; }
.va-how { color: #666; font-size: 0.8rem; margin-left: 0.5rem; }

.va-subject { border: 1px solid #e5e5e5; border-radius: 6px; margin: 1rem 0; padding: 1rem; }
.va-subject header { align-items: baseline; display: flex; gap: 0.75rem; flex-wrap: wrap; }
.va-subject h3 { margin: 0; }
.va-verdict { border-radius: 3px; font-size: 0.8rem; padding: 0.1rem 0.4rem; text-transform: uppercase; }
.va-verdict.va-changed { background: #fde8c8; }
.va-verdict.va-new { background: #d8e8fd; }
.va-verdict.va-incomparable { background: #f8d8d8; }
.va-because { color: #666; font-size: 0.9rem; }
.va-decision { color: #2a7; font-size: 0.9rem; }

.va-modes { display: flex; gap: 0.25rem; }
.va-mode { background: #f4f4f4; border: 1px solid #ddd; border-radius: 3px; cursor: pointer; font-size: 0.85rem; padding: 0.15rem 0.5rem; }
.va-mode.va-current { background: #333; border-color: #333; color: #fff; }

.va-frame { display: inline-block; margin: 0.5rem 0; position: relative; }
/* height: auto, because a deferred raster carries its own dimensions as
   attributes, and max-width alone would scale the width and keep the declared
   height — every candidate squashed to the aspect ratio of nothing. */
.va-frame img { display: block; height: auto; image-rendering: pixelated; max-width: 100%; }
/* Pinned to the corner rather than inset: 0 — stretched between top and bottom,
   an auto height fills the frame, and the candidate would be drawn at the
   baseline's height whenever the two differ, which is often the change. */
.va-frame .va-overlaid { left: 0; position: absolute; top: 0; }
.va-swipe .va-swipe-top { inset: 0 auto 0 0; overflow: hidden; position: absolute; }
.va-swipe .va-swipe-top img { max-width: none; }
.va-side-by-side { display: flex; gap: 1rem; }
.va-side-by-side img { height: auto; image-rendering: pixelated; max-width: 100%; }

.va-regions { inset: 0; pointer-events: none; position: absolute; }
.va-region { position: absolute; }
.va-region.va-cause { outline: 2px solid #c2410c; }
.va-region.va-collateral { outline: 1px dashed #64748b; }
.va-region-label { background: #c2410c; color: #fff; font-size: 0.7rem; left: 0; padding: 0 0.2rem; position: absolute; top: -1.1rem; white-space: nowrap; }
.va-region.va-collateral .va-region-label { background: #64748b; }

.va-nav { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.va-nav button { background: #f4f4f4; border: 1px solid #ddd; border-radius: 3px; cursor: pointer; font: inherit; padding: 0.25rem 0.75rem; }
.va-nav button.va-current { background: #333; border-color: #333; color: #fff; cursor: default; }

.va-filter { align-items: center; display: flex; gap: 0.5rem; margin: 0.75rem 0; }
.va-filter input { border: 1px solid #ccc; border-radius: 3px; font: inherit; padding: 0.2rem 0.4rem; }

.va-changes { list-style: none; margin: 0; padding: 0; }
.va-change { border-bottom: 1px solid #e5e5e5; padding: 0.75rem 0; }
.va-change h3 { margin: 0 0 0.25rem; }
.va-change-meta, .va-fingerprint { color: #666; font-size: 0.9rem; margin: 0.15rem 0; }
.va-change-subjects { columns: 3 14rem; font-size: 0.9rem; }
.va-ungrouped { border-top: 2px solid #333; margin-top: 1.5rem; }

/* The three stability states are drawn as three, deliberately: unknown is not
   clean, and a rate nobody swept for is not a rate of zero. */
.va-history { margin: 0.5rem 0; }
.va-ask { background: none; border: 1px solid #ddd; border-radius: 3px; cursor: pointer; font: inherit; font-size: 0.9rem; padding: 0.2rem 0.6rem; }
.va-stability, .va-churn { font-size: 0.9rem; margin: 0.25rem 0; }
.va-stability.va-unknown { color: #a56000; }
.va-stability.va-flaky { color: #a11; }

.va-findings { color: #a56000; font-size: 0.9rem; }
.va-not-observed .va-failed { color: #a11; font-weight: 600; }
.va-actions { display: flex; align-items: center; gap: 0.5rem; }
.va-actions button { cursor: pointer; padding: 0.3rem 0.8rem; }
.va-actions button:disabled { cursor: not-allowed; opacity: 0.5; }

@media (prefers-color-scheme: dark) {
  .va-note, .va-branch, .va-counts, .va-because, .va-collateral,
  .va-change-meta, .va-fingerprint, .va-how { color: #999; }
  .va-variation { border-bottom-color: #333; }
  .va-nav button { background: #222; border-color: #444; color: #eee; }
  .va-nav button.va-current { background: #eee; color: #111; }
  .va-change { border-bottom-color: #333; }
  .va-ungrouped { border-top-color: #ccc; }
  .va-ask { border-color: #444; color: #eee; }
  .va-filter input { background: #111; border-color: #444; color: #eee; }
  .va-build { border-bottom-color: #333; }
  .va-subject { border-color: #333; }
  .va-docket th { border-bottom-color: #ccc; }
  .va-docket td { border-bottom-color: #333; }
  .va-mode { background: #222; border-color: #444; color: #eee; }
  .va-mode.va-current { background: #eee; color: #111; }
}
`;
