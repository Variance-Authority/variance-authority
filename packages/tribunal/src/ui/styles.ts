/**
 * The stylesheet, as a string the operator injects.
 *
 * Not imported, not bundled, not a CSS module and not a dependency on anybody's
 * build. A component library that ships a `.css` import decides the consumer's
 * toolchain for them; this one hands over text and lets them put it in a
 * `<style>` tag, a `layout.tsx`, or nowhere at all — the markup carries plain
 * class names and degrades to unstyled rather than to broken.
 *
 * Three decisions here are load-bearing rather than decorative:
 *
 * **Cause and collateral are drawn differently.** A single highlight colour would
 * make the box that was edited and the box that merely reflowed look like the
 * same finding, which is precisely the mistake ranking by area makes.
 *
 * **Images render at their own pixel grid.** `image-rendering: pixelated` and no
 * smoothing, because a reviewer zooming into a 2px shift must see 2px and not an
 * interpolation of it.
 *
 * **The page does not grow with the build.** Every pane scrolls inside its own
 * box and the document does not scroll at all. Twenty full-page routes stacked
 * down one document is twenty-seven thousand pixels of page, and a reviewer who
 * has to scroll past a whole render to reach the next subject stops reading them
 * — which is the review blindness this surface exists to refuse, arriving as a
 * layout instead of as a ranking.
 *
 * Colour is spent through tokens on `:root`, so the dark scheme re-decides values
 * and never rules. A second scheme that could move a box is a second chance to
 * disagree with the region coordinates the run measured.
 */
export const REVIEW_STYLES = `
:root, .va-app { --va-bg: #f4f5f8; --va-surface: #ffffff; --va-sunken: #eceef3; --va-line: #e0e3ea; --va-line-firm: #c8cddb; --va-ink: #12151c; --va-ink-2: #4d5566; --va-ink-3: #79839a; --va-accent: #4f46e5; --va-accent-ink: #ffffff; --va-warn: #b45309; --va-warn-bg: #fdf0d5; --va-warn-ink: #713f12; --va-bad: #b91c1c; --va-bad-bg: #fde3e3; --va-bad-ink: #7f1d1d; --va-good: #047857; --va-good-bg: #d6f2e6; --va-good-ink: #064e3b; --va-info-bg: #dde7fd; --va-info-ink: #1e3a8a; --va-cause: #c2410c; --va-collateral: #64748b; --va-shade: rgba(17, 24, 39, 0.08); }

.va-app { background: var(--va-bg); color: var(--va-ink); display: flex; flex-direction: column; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 14px; height: 100dvh; line-height: 1.5; overflow: hidden; }
/* The element reset, every rule of it wrapped in :where() so the whole block
   weighs nothing. Written plainly, a rule like .va-app h2 scores higher than any
   single-class rule below it, and the component that says what its own heading
   looks like loses to a reset it never knew it was arguing with. That failure is
   invisible on the page and invisible in review: the sheet reads correctly and
   the render simply is not it. A reset is the sentence "unless somebody says
   otherwise", and :where() is how that clause is spelled. */
:where(.va-app *, .va-app *::before, .va-app *::after) { box-sizing: border-box; }
:where(.va-app h1, .va-app h2, .va-app h3) { line-height: 1.25; margin: 0; }
:where(.va-app h1) { font-size: 1.35rem; letter-spacing: -0.01em; }
:where(.va-app h2) { font-size: 0.95rem; letter-spacing: -0.005em; }
:where(.va-app h3) { font-size: 1.05rem; letter-spacing: -0.005em; }
:where(.va-app p) { margin: 0; }
:where(.va-app code, .va-commit) { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; font-size: 0.85em; }
.va-num { font-variant-numeric: tabular-nums; }

/* Same reasoning, and this is where it was actually caught: the rail item, the
   mode pill and the build opener each declared no border and were given one
   anyway. */
:where(.va-app button) { background: var(--va-surface); border: 1px solid var(--va-line-firm); border-radius: 7px; color: var(--va-ink); cursor: pointer; font: inherit; padding: 0.35rem 0.75rem; }
:where(.va-app button:hover) { border-color: var(--va-ink-3); }
:where(.va-app button:disabled) { cursor: not-allowed; opacity: 0.55; }
:where(.va-app button.va-current:disabled) { cursor: default; opacity: 1; }
:where(.va-app input) { background: var(--va-surface); border: 1px solid var(--va-line-firm); border-radius: 7px; color: var(--va-ink); font: inherit; padding: 0.35rem 0.6rem; }
:where(.va-app ul, .va-app ol) { list-style: none; margin: 0; padding: 0; }

/* The three panes. \`min-height: 0\` on each, because a flex child defaults to a
   floor of its content and a rail of two hundred subjects would push the shell
   past the viewport rather than scrolling inside it. */
.va-body { display: flex; flex: 1; min-height: 0; }
.va-scroll { min-height: 0; overflow: auto; overscroll-behavior: contain; }
.va-page { flex: 1; margin: 0 auto; max-width: 72rem; min-width: 0; padding: 1.5rem 1.75rem 4rem; }

.va-topbar { align-items: center; background: var(--va-surface); border-bottom: 1px solid var(--va-line); display: flex; flex: none; gap: 0.75rem; padding: 0.7rem 1rem; }
.va-brand { background: var(--va-accent); border-radius: 8px; flex: none; height: 26px; width: 26px; }
.va-topbar-title { display: flex; flex-direction: column; line-height: 1.2; }
.va-topbar-title strong { font-size: 0.95rem; }
.va-topbar-sub { color: var(--va-ink-3); font-size: 0.78rem; }
.va-topbar-meta { align-items: center; color: var(--va-ink-3); display: flex; flex-wrap: wrap; font-size: 0.8rem; gap: 0.5rem; justify-content: flex-end; margin-left: auto; }
.va-topbar-meta .va-commit { background: var(--va-sunken); border-radius: 5px; color: var(--va-ink-2); padding: 0.1rem 0.35rem; }
.va-back { flex: none; }

.va-nav { display: flex; gap: 0.35rem; }
.va-nav button.va-current { background: var(--va-accent); border-color: var(--va-accent); color: var(--va-accent-ink); cursor: default; }

.va-pill { border-radius: 999px; flex: none; font-size: 0.75rem; font-weight: 600; padding: 0.15rem 0.6rem; white-space: nowrap; }
.va-pill.va-warn { background: var(--va-warn-bg); color: var(--va-warn-ink); }
.va-pill.va-good { background: var(--va-good-bg); color: var(--va-good-ink); }
.va-pill.va-bad { background: var(--va-bad-bg); color: var(--va-bad-ink); }

.va-note { color: var(--va-ink-3); font-size: 0.88rem; }
.va-failure { background: var(--va-bad-bg); border-radius: 8px; color: var(--va-bad-ink); font-size: 0.88rem; margin: 0.5rem 0; padding: 0.6rem 0.75rem; }
.va-card { background: var(--va-surface); border: 1px solid var(--va-line); border-radius: 12px; margin-bottom: 1rem; padding: 1rem 1.1rem; }
.va-card > h2 { color: var(--va-ink-3); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.09em; margin-bottom: 0.6rem; text-transform: uppercase; }

.va-builds { display: grid; gap: 0.85rem; }
.va-build { background: var(--va-surface); border: 1px solid var(--va-line); border-radius: 12px; padding: 0.9rem 1.1rem; }
.va-build-head { align-items: center; display: flex; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 0.45rem; }
.va-build-open { align-items: baseline; background: none; border: 0; border-radius: 0; display: flex; gap: 0.5rem; padding: 0; }
.va-build-id { font-size: 1.05rem; font-weight: 650; letter-spacing: -0.01em; }
.va-build-go { color: var(--va-accent); font-size: 0.82rem; font-weight: 600; }
.va-commit { background: var(--va-sunken); border-radius: 5px; color: var(--va-ink-2); padding: 0.1rem 0.35rem; }
.va-branch { color: var(--va-ink-2); font-size: 0.82rem; }
.va-when { color: var(--va-ink-3); font-size: 0.78rem; margin-left: auto; }

.va-verdicts { align-items: center; display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.3rem; }
.va-pending { color: var(--va-warn); font-weight: 650; }
.va-settled { color: var(--va-good); font-weight: 650; }
.va-counts { color: var(--va-ink-3); font-size: 0.84rem; }
.va-coverage { color: var(--va-ink-2); font-size: 0.84rem; }
.va-coverage.va-unknown { color: var(--va-warn); }
.va-coverage.va-incomplete { color: var(--va-bad); font-weight: 600; }

/* The rail: every reviewable subject at a glance, so the reviewer chooses which
   render to open instead of scrolling through all of them. */
.va-rail { background: var(--va-surface); border-right: 1px solid var(--va-line); flex: none; padding: 0.6rem; width: 20rem; }
.va-rail-group { align-items: center; color: var(--va-ink-3); display: flex; font-size: 0.7rem; font-weight: 700; gap: 0.4rem; letter-spacing: 0.09em; padding: 0.9rem 0.55rem 0.35rem; text-transform: uppercase; }
.va-rail-count { background: var(--va-sunken); border-radius: 999px; color: var(--va-ink-2); font-size: 0.7rem; letter-spacing: 0; padding: 0 0.4rem; }
.va-rail-item { align-items: center; background: none; border: 1px solid transparent; border-radius: 8px; display: flex; gap: 0.55rem; margin-bottom: 0.1rem; padding: 0.45rem 0.55rem; text-align: left; width: 100%; }
.va-rail-item:hover { background: var(--va-sunken); }
.va-rail-item.va-current { background: var(--va-accent); border-color: var(--va-accent); color: var(--va-accent-ink); }
.va-rail-body { min-width: 0; }
.va-rail-name { display: block; font-size: 0.86rem; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.va-rail-note { color: var(--va-ink-3); display: block; font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.va-rail-item.va-current .va-rail-note { color: var(--va-accent-ink); }
.va-dot { border-radius: 50%; flex: none; height: 8px; width: 8px; }
.va-dot.va-changed { background: var(--va-warn); }
.va-dot.va-new { background: var(--va-accent); }
.va-dot.va-incomparable { background: var(--va-bad); }
.va-dot.va-unstable { background: var(--va-bad); }
.va-dot.va-failed { background: var(--va-bad); }
.va-dot.va-ignored { background: var(--va-ink-3); }
.va-dot.va-unchanged { background: var(--va-good); }
.va-mark { flex: none; font-size: 0.8rem; margin-left: auto; }
.va-mark.va-approved { color: var(--va-good); }
.va-mark.va-rejected { color: var(--va-bad); }

.va-stage { background: var(--va-bg); flex: 1; }
.va-subject { display: flex; flex: 1; min-height: 0; }
.va-subject-head { align-items: center; display: flex; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 0.35rem; }
.va-verdict { border-radius: 999px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; padding: 0.15rem 0.55rem; text-transform: uppercase; }
.va-verdict.va-changed { background: var(--va-warn-bg); color: var(--va-warn-ink); }
.va-verdict.va-new { background: var(--va-info-bg); color: var(--va-info-ink); }
.va-verdict.va-incomparable { background: var(--va-bad-bg); color: var(--va-bad-ink); }
.va-verdict.va-unstable { background: var(--va-bad-bg); color: var(--va-bad-ink); }
.va-because { color: var(--va-ink-2); font-size: 0.88rem; }
.va-intent { color: var(--va-ink-2); font-size: 0.88rem; }
.va-subtitle { color: var(--va-ink-3); font-size: 0.88rem; margin-top: 0.2rem; }

/* The right-hand column: everything that is not the picture. A reviewer decides
   from the record and the defect list, and neither should cost a scroll past a
   nine-thousand-pixel render to reach. */
.va-aside { background: var(--va-surface); border-left: 1px solid var(--va-line); flex: none; padding: 1rem; width: 22rem; }
.va-aside .va-card { background: var(--va-sunken); border-color: transparent; }
.va-aside h2 { color: var(--va-ink-3); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.09em; margin-bottom: 0.5rem; text-transform: uppercase; }

.va-docket table { border-collapse: collapse; width: 100%; }
.va-docket th { border-bottom: 1px solid var(--va-line-firm); color: var(--va-ink-3); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.07em; padding: 0 0.5rem 0.4rem; text-align: left; text-transform: uppercase; }
.va-docket td { border-bottom: 1px solid var(--va-line); padding: 0.5rem; vertical-align: middle; }
.va-docket tr:last-child td { border-bottom-color: transparent; }
.va-docket th.va-right, .va-docket td.va-right { text-align: right; }
.va-docket .va-file { color: var(--va-ink-2); }
.va-bar { background: var(--va-sunken); border-radius: 999px; display: block; height: 6px; margin-top: 0.3rem; overflow: hidden; width: 100%; }
.va-bar span { background: var(--va-cause); display: block; height: 100%; }
.va-collateral { border-top: 1px solid var(--va-line); color: var(--va-ink-3); font-size: 0.84rem; margin-top: 0.75rem; padding-top: 0.65rem; }

.va-variation-list { display: grid; gap: 0.5rem; }
.va-variation { background: var(--va-sunken); border-radius: 9px; padding: 0.6rem 0.75rem; }
.va-variation-head { align-items: baseline; display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.15rem; }
/* Every chip carries its own text colour rather than inheriting the page's: the
   backgrounds are light in both schemes, and a chip that inherited a dark
   scheme's foreground would be pale text on a pale block. */
.va-axis { background: var(--va-info-bg); border-radius: 999px; color: var(--va-info-ink); font-size: 0.72rem; font-weight: 650; padding: 0.1rem 0.5rem; }
/* The two states a reviewer can act on, and they are not the same finding: an
   arm that changes nothing was measured, a pair with no parent never was. */
.va-variation.va-inert .va-axis { background: var(--va-warn-bg); color: var(--va-warn-ink); }
.va-variation.va-unlinked .va-axis { background: var(--va-bad-bg); color: var(--va-bad-ink); }
.va-how { color: var(--va-ink-3); font-size: 0.75rem; }

.va-modes { background: var(--va-sunken); border-radius: 9px; display: inline-flex; gap: 0.15rem; margin: 0.85rem 0 0.6rem; padding: 0.2rem; }
.va-mode { background: none; border: 1px solid transparent; border-radius: 7px; font-size: 0.82rem; padding: 0.2rem 0.65rem; }
.va-mode.va-current { background: var(--va-surface); border-color: var(--va-line); box-shadow: 0 1px 2px var(--va-shade); font-weight: 600; }

.va-frame { background: var(--va-surface); border: 1px solid var(--va-line); border-radius: 10px; display: inline-block; margin: 0; position: relative; }
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
.va-side-by-side figure { margin: 0; min-width: 0; }
.va-side-by-side figcaption { color: var(--va-ink-3); font-size: 0.75rem; letter-spacing: 0.07em; margin-bottom: 0.3rem; text-transform: uppercase; }
.va-side-by-side img { border: 1px solid var(--va-line); border-radius: 10px; height: auto; image-rendering: pixelated; max-width: 100%; }
.va-viewer input[type="range"] { display: block; margin-top: 0.6rem; width: min(28rem, 100%); }
.va-pixels { color: var(--va-ink-3); font-size: 0.82rem; margin-top: 0.5rem; }

.va-regions { inset: 0; pointer-events: none; position: absolute; }
.va-region { position: absolute; }
.va-region.va-cause { outline: 2px solid var(--va-cause); }
.va-region.va-collateral { outline: 1px dashed var(--va-collateral); }
.va-region-label { background: var(--va-cause); border-radius: 3px; color: #ffffff; font-size: 0.68rem; font-weight: 600; left: 0; padding: 0 0.25rem; position: absolute; top: -1.15rem; white-space: nowrap; }
.va-region.va-collateral .va-region-label { background: var(--va-collateral); }

.va-filter { align-items: center; display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0; }

.va-changes { display: grid; gap: 0.85rem; }
.va-change { background: var(--va-surface); border: 1px solid var(--va-line); border-radius: 12px; padding: 0.9rem 1.1rem; }
.va-change h3 { font-size: 1rem; margin-bottom: 0.25rem; }
.va-change-meta, .va-fingerprint { color: var(--va-ink-3); font-size: 0.82rem; }
.va-fingerprint { border-top: 1px solid var(--va-line); margin-top: 0.65rem; padding-top: 0.55rem; }
.va-change-subjects { color: var(--va-ink-2); columns: 3 14rem; font-size: 0.84rem; margin-top: 0.4rem; }
.va-ungrouped { border-top: 1px solid var(--va-line-firm); margin-top: 1.75rem; padding-top: 1.25rem; }

/* The three stability states are drawn as three, deliberately: unknown is not
   clean, and a rate nobody swept for is not a rate of zero. */
.va-history { font-size: 0.86rem; }
.va-ask { font-size: 0.86rem; width: 100%; }
.va-stability, .va-churn { color: var(--va-ink-2); font-size: 0.86rem; margin-bottom: 0.5rem; }
.va-stability.va-unknown { color: var(--va-warn); }
.va-stability.va-flaky { color: var(--va-bad); }

/* One finding, in three registers: what it is, where it is, and the sentence
   that explains it. The rule id is last because it is the least of the three to
   a person and the whole of it to an ignore list. */
.va-findings { display: grid; gap: 0.7rem; }
.va-finding { border-left: 2px solid var(--va-warn); padding-left: 0.7rem; }
.va-finding-title { font-size: 0.88rem; font-weight: 650; }
.va-finding-where { color: var(--va-ink-2); font-size: 0.8rem; }
.va-finding-what { color: var(--va-ink-2); font-size: 0.8rem; margin-top: 0.2rem; }
.va-finding-owner { align-items: center; display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.35rem; }
.va-tag { background: var(--va-surface); border: 1px solid var(--va-line); border-radius: 5px; color: var(--va-ink-2); font-size: 0.72rem; padding: 0.1rem 0.4rem; }
.va-tag.va-rule { color: var(--va-ink-3); }

.va-not-observed { color: var(--va-ink-2); display: grid; font-size: 0.86rem; gap: 0.35rem; }
.va-not-observed .va-failed { color: var(--va-bad); font-weight: 600; }

.va-decision { color: var(--va-good); font-size: 0.86rem; margin-bottom: 0.5rem; }
.va-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.va-actions button { flex: 1; font-weight: 600; }
.va-actions .va-approve { background: var(--va-good); border-color: var(--va-good); color: #ffffff; }
.va-actions .va-approve:disabled { background: var(--va-sunken); border-color: var(--va-line-firm); color: var(--va-ink-3); }

@media (max-width: 60rem) {
  .va-body { flex-wrap: wrap; }
  .va-rail { border-right: 0; width: 100%; }
  .va-subject { flex-wrap: wrap; }
  .va-aside { border-left: 0; width: 100%; }
}

@media (prefers-color-scheme: dark) {
  :root, .va-app { --va-bg: #0c0f16; --va-surface: #141922; --va-sunken: #1b2130; --va-line: #232a38; --va-line-firm: #343d4e; --va-ink: #e7ecf4; --va-ink-2: #a7b1c4; --va-ink-3: #79839a; --va-accent: #6366f1; --va-accent-ink: #ffffff; --va-warn: #f0b429; --va-warn-bg: #3b2c0a; --va-warn-ink: #fbe0a2; --va-bad: #f87171; --va-bad-bg: #3a1a1a; --va-bad-ink: #fecaca; --va-good: #34d399; --va-good-bg: #0e3229; --va-good-ink: #a7f3d0; --va-info-bg: #1a2a45; --va-info-ink: #c7dbff; --va-cause: #fb923c; --va-collateral: #94a3b8; --va-shade: rgba(0, 0, 0, 0.5); }
}
`;
