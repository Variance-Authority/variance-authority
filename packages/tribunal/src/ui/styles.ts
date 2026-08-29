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
 * Colour is spent through tokens on `:root`, so a second scheme re-decides values
 * and never rules. A scheme that could move a box is a second chance to disagree
 * with the region coordinates the run measured.
 *
 * The ground is dark, and that is a decision rather than a default. A capture is
 * the only thing on this page whose colour is evidence; every pixel of chrome
 * around it is the room the evidence is read in, and a room that is brighter than
 * the exhibit shifts what the exhibit looks like. `prefers-color-scheme: light`
 * re-decides the same twenty-four values for a reader who asks for it.
 *
 * The palette is `docs/visual-guidelines.md` — deep, panel, ivory, quiet, warm,
 * variance orange, signal green — spent here on a surface that also has to say
 * *unknown* and *refused*, which brand assets never do. The font tokens name
 * Inter and JetBrains Mono first and fall back to the system stacks: this sheet is
 * handed over as text, so it can ask for a face and must not require one.
 */
export const REVIEW_STYLES = `
:root, .va-app { --va-bg: #181b1d; --va-surface: #1e2224; --va-sunken: #181b1d; --va-line: #2f3437; --va-line-firm: #434a4d; --va-ink: #f3f4f6; --va-ink-2: #a8a09b; --va-ink-3: #8f8580; --va-accent: #ff4a19; --va-accent-ink: #181b1d; --va-warn: #e0a458; --va-warn-bg: #2a2118; --va-warn-ink: #f0c48a; --va-bad: #e5695c; --va-bad-bg: #2c1b18; --va-bad-ink: #f3a99e; --va-good: #7fa28c; --va-good-bg: #1a2420; --va-good-ink: #a8c9b5; --va-info-bg: #24282a; --va-info-ink: #d6d0cb; --va-cause: #ff4a19; --va-collateral: #8f8580; --va-accent-soft: rgba(255, 74, 25, 0.14); --va-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; --va-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }

.va-app { background: var(--va-bg); color: var(--va-ink); color-scheme: dark light; display: flex; flex-direction: column; font-family: var(--va-sans); font-size: 14px; height: 100dvh; line-height: 1.5; overflow: hidden; }
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
:where(.va-app code, .va-commit) { font-family: var(--va-mono); font-size: 0.85em; }
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

/* The two things the reset above would otherwise have taken away. A surface that
   reports \`nested-interactive\` and unreachable controls cannot itself leave a
   keyboard reviewer guessing where they are — and the seam is the case that
   forces it, being an appearance-stripped range with no border of its own. */
:where(.va-app a, .va-app button, .va-app summary, .va-app input, .va-app [tabindex]):focus-visible { outline: 2px solid var(--va-accent); outline-offset: 3px; }
.va-app ::selection { background: var(--va-accent); color: var(--va-accent-ink); }

/* The three panes. \`min-height: 0\` on each, because a flex child defaults to a
   floor of its content and a rail of two hundred subjects would push the shell
   past the viewport rather than scrolling inside it. */
.va-body { display: flex; flex: 1; min-height: 0; }
.va-scroll { min-height: 0; overflow: auto; overscroll-behavior: contain; }
.va-page { flex: 1; margin: 0 auto; max-width: 72rem; min-width: 0; padding: 1.5rem 1.75rem 4rem; }

.va-topbar { align-items: center; background: var(--va-surface); border-bottom: 1px solid var(--va-line); display: flex; flex: none; gap: 0.75rem; padding: 0.7rem 1rem; }
.va-brand { color: var(--va-ink); flex: none; }
.va-topbar-title { display: flex; flex-direction: column; line-height: 1.2; }
.va-topbar-title strong { font-size: 0.95rem; }
.va-topbar-sub { color: var(--va-ink-3); font-size: 0.78rem; }
.va-topbar-meta { align-items: center; color: var(--va-ink-3); display: flex; flex-wrap: wrap; font-size: 0.8rem; gap: 0.5rem; justify-content: flex-end; margin-left: auto; }
.va-topbar-meta .va-commit { background: var(--va-sunken); border-radius: 5px; color: var(--va-ink-2); padding: 0.1rem 0.35rem; }
.va-back { flex: none; }

.va-nav { display: flex; gap: 0.35rem; }
.va-nav button.va-current { background: var(--va-accent-soft); border-color: var(--va-accent); color: var(--va-accent); cursor: default; }

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
.va-rail-item.va-current { background: var(--va-accent-soft); border-color: var(--va-accent); }
.va-rail-body { min-width: 0; }
.va-rail-name { display: block; font-size: 0.86rem; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.va-rail-note { color: var(--va-ink-3); display: block; font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.va-rail-item.va-current .va-rail-note { color: var(--va-ink-2); }
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

.va-stage { background: var(--va-bg); flex: 1; min-width: 0; }
.va-subject { display: flex; flex: 1; min-height: 0; min-width: 0; }
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

/* The review unit, which is a change and not a picture. Each card is one edit
   and every place it landed, so the card is given the weight a row in a table
   never had: a reviewer approves at this level and reads the subjects inside it
   as evidence. The left edge is the cause colour, the same one the region boxes
   use, because that is what the card is. */
.va-origins { display: grid; gap: 0.75rem; margin-top: 0.75rem; }
.va-origin { background: var(--va-sunken); border-left: 3px solid var(--va-cause); border-radius: 10px; padding: 0.85rem 1rem; }
.va-origin.va-orphan { border-left-color: var(--va-warn); }
.va-origin-head { align-items: baseline; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.va-origin-head h3 { font-size: 1rem; margin: 0; }
.va-origin-pixels { color: var(--va-ink-3); font-size: 0.84rem; margin-left: auto; }
.va-file { color: var(--va-ink-2); }
.va-origin p { font-size: 0.86rem; margin: 0.35rem 0 0; }
.va-origin .va-churn, .va-origin .va-stability { margin: 0.35rem 0 0; }
.va-origin-arrival.va-alarm { background: var(--va-bad-bg); border-radius: 6px; color: var(--va-bad-ink); padding: 0.35rem 0.55rem; }
/* Two shapes under one component name is two edits, and the sentence saying so
   is the one thing on the card that withdraws the batch approval. */
.va-note.va-warned { color: var(--va-warn-ink); }
.va-origin-where { display: grid; font-size: 0.86rem; gap: 0.35rem; margin-top: 0.7rem; }
.va-origin-where li { align-items: baseline; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.va-origin-subject { font-weight: 600; }
.va-origin-act { align-items: center; display: flex; flex-wrap: wrap; gap: 0.55rem; margin-top: 0.8rem; }
.va-origin-act button { font-weight: 600; }
.va-origin-act .va-approve { background: var(--va-good); border-color: var(--va-good); color: #ffffff; }
.va-origin-act .va-approve:disabled { background: var(--va-sunken); border-color: var(--va-line-firm); color: var(--va-ink-3); }
.va-collateral { border-top: 1px solid var(--va-line); color: var(--va-ink-3); font-size: 0.84rem; margin-top: 0.75rem; padding-top: 0.65rem; }

/* The third axis: what the commit reaches, crossed with what the run saw. Drawn
   as a grid rather than four counts, because the four cells are one crossing and
   a reader who takes them in as a shape sees at once which half of it is the
   anomaly. */
.va-reach .va-quad { display: grid; gap: 0.5rem; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 0.9rem; }
.va-cell { background: var(--va-sunken); border-left: 3px solid var(--va-line-firm); border-radius: 9px; display: grid; gap: 0.1rem; padding: 0.7rem 0.85rem; }
.va-cell-n { font-size: 1.6rem; font-weight: 650; letter-spacing: -0.02em; line-height: 1.15; }
.va-cell-title { font-size: 0.82rem; font-weight: 650; }
.va-cell-note { color: var(--va-ink-3); font-size: 0.78rem; }
.va-cell.va-expected { border-left-color: var(--va-accent); }
.va-cell.va-alarm { background: var(--va-bad-bg); border-left-color: var(--va-bad); }
.va-cell.va-alarm .va-cell-n, .va-cell.va-alarm .va-cell-title { color: var(--va-bad-ink); }
.va-cell.va-inert { background: var(--va-warn-bg); border-left-color: var(--va-warn); }
.va-cell.va-inert .va-cell-n, .va-cell.va-inert .va-cell-title { color: var(--va-warn-ink); }
/* A quadrant holding nothing keeps its place and loses its voice. Dropped, it
   reads as a question nobody asked; coloured as a finding, as one nobody
   answered. */
.va-cell.va-zero { background: transparent; border-left-color: var(--va-line); }
.va-cell.va-zero .va-cell-n, .va-cell.va-zero .va-cell-title { color: var(--va-ink-3); font-weight: 550; }

.va-reach .va-band { border-left: 2px solid var(--va-line-firm); margin-top: 1.1rem; padding-left: 0.85rem; }
.va-reach .va-band.va-alarm { border-left-color: var(--va-bad); }
.va-reach .va-band.va-inert { border-left-color: var(--va-warn); }
.va-reach .va-band h3 { font-size: 0.95rem; margin-bottom: 0.25rem; }
.va-reach .va-stability, .va-reach .va-churn { margin: 0.2rem 0 0; }
.va-reach-list { display: grid; font-size: 0.86rem; gap: 0.5rem; margin-top: 0.55rem; }
.va-reach-list.va-columns { columns: 2 18rem; display: block; }
.va-reach-list.va-columns li { break-inside: avoid; margin-bottom: 0.35rem; }

/* The chain, which is the half a reviewer can disprove. A component named
   without it is an assertion; tokens.css to button.tsx to Button is a claim
   somebody can open three files and refute. */
.va-trails { display: grid; font-size: 0.84rem; gap: 0.35rem; margin-top: 0.55rem; }
.va-trails code { background: var(--va-sunken); border-radius: 5px; color: var(--va-ink-2); padding: 0.1rem 0.35rem; }
.va-arrow { color: var(--va-ink-3); padding: 0 0.3rem; }
.va-axis.va-unread { background: var(--va-warn-bg); color: var(--va-warn-ink); margin-left: 0.5rem; }

/* Drawn where the crossing would have been, never beside it: an empty grid over
   a diff nothing could attribute reads as this commit reaches none of your
   subjects, which is a sentence somebody merges on. */
.va-refusal { background: var(--va-warn-bg); border-radius: 9px; color: var(--va-warn-ink); font-size: 0.86rem; margin-top: 0.9rem; padding: 0.6rem 0.75rem; }
.va-reach-note { border-top: 1px solid var(--va-line); margin-top: 0.9rem; padding-top: 0.6rem; }
.va-reach-note code { color: var(--va-ink-2); }
.va-lost { color: var(--va-bad); }

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

/* The bar over the stage: what is being compared, how large it is drawn, and
   which finding is being looked at. Three groups rather than one row of
   everything, because they are asked in that order and answered independently. */
.va-viewer-bar { align-items: center; display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.85rem 0 0.6rem; }
.va-modes, .va-zooms { background: var(--va-sunken); border-radius: 9px; display: inline-flex; gap: 0.15rem; padding: 0.2rem; }
.va-mode { background: none; border: 1px solid transparent; border-radius: 7px; font-family: var(--va-mono); font-size: 0.72rem; letter-spacing: 0.08em; padding: 0.25rem 0.6rem; text-transform: uppercase; }
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
.va-showing { color: var(--va-ink-2); font-family: var(--va-mono); font-size: 0.72rem; margin: 0 0 0 0.2rem; }

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
.va-stability.va-unknown, .va-churn.va-unknown { color: var(--va-warn); }
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
  .va-reach .va-quad { grid-template-columns: minmax(0, 1fr); }
}

/* Motion is never how anything here is said, so there is nothing to preserve when
   a reader has asked for less of it. The blink and the scroll to a region are
   turned off in the component that starts them, because neither is a CSS
   animation this could reach; this catches the transitions. */
@media (prefers-reduced-motion: reduce) {
  .va-app *, .va-app *::before, .va-app *::after { animation-duration: 1ms; animation-iteration-count: 1; scroll-behavior: auto; transition-duration: 1ms; }
}

@media (prefers-color-scheme: light) {
  :root, .va-app { --va-bg: #f3f4f6; --va-surface: #ffffff; --va-sunken: #e9eaec; --va-line: #d8d6d3; --va-line-firm: #b8b3ae; --va-ink: #181b1d; --va-ink-2: #4c4844; --va-ink-3: #756d67; --va-accent: #d83a13; --va-accent-ink: #ffffff; --va-warn: #8a5a12; --va-warn-bg: #f7ecd9; --va-warn-ink: #5c3c08; --va-bad: #b03a2b; --va-bad-bg: #f8e3df; --va-bad-ink: #7a2418; --va-good: #46705a; --va-good-bg: #dfece4; --va-good-ink: #2b4a38; --va-info-bg: #ecebe9; --va-info-ink: #3d3935; --va-cause: #d83a13; --va-collateral: #756d67; --va-accent-soft: rgba(216, 58, 19, 0.10); }
}
`;
