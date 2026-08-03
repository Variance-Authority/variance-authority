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
.va-frame img { display: block; image-rendering: pixelated; max-width: 100%; }
.va-frame .va-overlaid { inset: 0; position: absolute; }
.va-swipe .va-swipe-top { inset: 0 auto 0 0; overflow: hidden; position: absolute; }
.va-swipe .va-swipe-top img { max-width: none; }
.va-side-by-side { display: flex; gap: 1rem; }
.va-side-by-side img { image-rendering: pixelated; max-width: 100%; }

.va-regions { inset: 0; pointer-events: none; position: absolute; }
.va-region { position: absolute; }
.va-region.va-cause { outline: 2px solid #c2410c; }
.va-region.va-collateral { outline: 1px dashed #64748b; }
.va-region-label { background: #c2410c; color: #fff; font-size: 0.7rem; left: 0; padding: 0 0.2rem; position: absolute; top: -1.1rem; white-space: nowrap; }
.va-region.va-collateral .va-region-label { background: #64748b; }

.va-findings { color: #a56000; font-size: 0.9rem; }
.va-not-observed .va-failed { color: #a11; font-weight: 600; }
.va-actions { display: flex; align-items: center; gap: 0.5rem; }
.va-actions button { cursor: pointer; padding: 0.3rem 0.8rem; }
.va-actions button:disabled { cursor: not-allowed; opacity: 0.5; }

@media (prefers-color-scheme: dark) {
  .va-note, .va-branch, .va-counts, .va-because, .va-collateral { color: #999; }
  .va-build { border-bottom-color: #333; }
  .va-subject { border-color: #333; }
  .va-docket th { border-bottom-color: #ccc; }
  .va-docket td { border-bottom-color: #333; }
  .va-mode { background: #222; border-color: #444; color: #eee; }
  .va-mode.va-current { background: #eee; color: #111; }
}
`;
