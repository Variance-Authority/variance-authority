/**
 * The accreted CSS that ADR-0003's applicability pruning exists to delete.
 *
 * "A document's stylesheets are not the subject's stylesheets." A story canvas
 * carries the harness's own chrome, a preview reset, the whole design system, and
 * a CSS-in-JS tag that has been growing a rule per story since page load. If any
 * of that reaches the digest, one unrelated component's CSS edit invalidates every
 * baseline in the repository — the headline false-invalidation mode.
 *
 * Each generator below is a different *reason* a rule survives to the document but
 * must not survive to the hash, because they fail at different pipeline steps and
 * a normalizer can pass one while failing another:
 *
 * | generator          | dropped at ADR-0003 step | what it catches if kept |
 * |--------------------|--------------------------|-------------------------|
 * | `chrome`           | 3 (matches no node)      | harness chrome leaking in |
 * | `deadUtilities`    | 3 (matches no node)      | volume — 400 rules of nothing |
 * | `staleStories`     | 3 (matches no node)      | growth over a session |
 * | `losingRules`      | 5 (loses the cascade)    | a matcher that stops at "matched" |
 * | `unmatchedMedia`   | 2 (condition false)      | conditionals digested as text |
 *
 * And two that must NOT be dropped — the false-negative guards, without which a
 * normalizer that simply deleted all injected CSS would score a perfect run:
 *
 * | `winningRules`     | survives, wins           | over-eager pruning |
 * | `matchedMedia`     | survives (condition true)| conditionals dropped wholesale |
 */

/** Simulated harness chrome + preview reset. Selectors deliberately name nothing
 * inside a subject: the subject is mounted into a bare container, never into the
 * toolbar/sidebar/docs shell these rules describe. */
export const CHROME_CSS = `
.sb-show-main { padding: 1rem; background: #fff; }
.sb-main-padded { padding: 1rem; }
#storybook-root > * { box-sizing: border-box; }
.sb-wrapper .sb-heading { font-size: 24px; margin: 0 0 12px; }
.sidebar-container { width: 220px; overflow: auto; }
.sidebar-item[data-selected='true'] { background: #e3f3ff; }
.os-content-glue { display: block; }
.docs-story { position: relative; padding: 24px; }
.sbdocs .sbdocs-content { max-width: 1000px; margin: 0 auto; }
.sbdocs-preview .docblock-argstable { border-collapse: collapse; }
[data-panel-id='addon-controls'] { display: block; }
html.sb-preview, body.sb-preview { margin: 0; padding: 0; }
button.sb-bar-button { border: 0; background: none; }
.innerZoomElementWrapper > * { transform-origin: 0 0; }
`;

/** Dead utility classes. Volume is the point: a pruner that is correct but
 * quadratic in rule count is a pruner nobody will run on a real canvas, and this
 * is where that shows up. */
export function deadUtilities(count: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(`.u-mt-${i}{margin-top:${i * 2}px}`);
    out.push(`.u-px-${i}{padding-left:${i}px;padding-right:${i}px}`);
    out.push(`.u-text-${i}{font-size:${10 + (i % 12)}px;color:hsl(${i % 360} 40% 40%)}`);
    out.push(`.grid-${i} > .col-${i}{flex-basis:${i}%}`);
  }
  return out.join('\n');
}

/**
 * Rules left behind by previously-rendered stories: generated class names that
 * exist in the `<style>` tag but on no node in *this* subject.
 *
 * `generation` is what makes the sheet grow between variants. The claim under test
 * is not "irrelevant CSS is ignored" but the stronger "irrelevant CSS *growing*
 * does not move the hash", which is the shape the real failure takes — the tag is
 * a few rules longer every time a developer visits another story before yours.
 */
export function staleStories(generation: number, storiesPerGeneration = 40): string {
  const out: string[] = [];
  const total = generation * storiesPerGeneration;
  for (let i = 0; i < total; i += 1) {
    // Zero-padded to eight characters so these cannot collide with the live
    // runtime's names, whose FNV-1a base36 output is at most seven. A collision
    // would be rare and catastrophic: a stale rule silently applying to the
    // subject makes a `hash-stable` case false while looking exactly like a
    // normalizer bug. Excluded by construction, re-checked in `corpus.test.tsx`.
    const name = String((i * 2654435761) % 1679616).padStart(8, '0');
    out.push(`.css-${name}{display:flex;gap:${i % 24}px;color:#3${i % 10}4${i % 10}5${i % 10}}`);
  }
  return out.join('\n');
}

/**
 * Rules that DO match nodes in the subject but lose the cascade to
 * `.ks-card .ks-card__body` (0,2,0) in the components sheet.
 *
 * These separate a normalizer that prunes by "does this selector match?" from one
 * that also resolves the cascade (step 5). Keeping a loser changes the hash while
 * changing nothing a user could see — and specificity wars that shuffle losers
 * without moving the winner are extremely common in real design systems.
 *
 * Every selector here is *strictly* lower in specificity than the components-sheet
 * rule it competes with, and every element it can reach in the corpus already
 * carries that rule. Equal specificity would not do: these sheets are installed
 * after the components sheet, so a tie is won on document order and the fixture
 * would quietly become a real change. Each pairing:
 *
 *   `.ks-card__body` (0,1,0)  loses to  `.ks-card .ks-card__body` (0,2,0)
 *   `h3` (0,0,1)              loses to  `.ks-card__title` (0,1,0)
 *   `li` (0,0,1)              loses to  `.ks-list__item` (0,1,0)
 *   `input` (0,0,1)           loses to  `.ks-field__input` (0,1,0)
 */
export const LOSING_RULES_CSS = `
.ks-card__body { color: #ff0000; font-size: 40px; }
h3 { font-size: 40px; font-weight: 100; }
li { color: #00aa00; padding-top: 40px; }
input { color: #ff0000; }
`;

/**
 * A rule that matches AND wins: same selector as the components sheet, injected
 * later, so document order breaks the specificity tie in its favour.
 *
 * The false-negative guard. Every other noise generator here rewards deletion; if
 * the corpus contained only those, "delete all injected CSS" would score 100%.
 * This one punishes it, and it is banded `token` because structure holds and only
 * a resolved value moved.
 */
export const WINNING_RULES_CSS = `
.ks-card .ks-card__body { color: #b3261e; }
`;

/** A condition that is false for the declared viewport. Its body would be a
 * visible change if it applied, so a normalizer that digests conditional text
 * instead of flattening it (step 2) is caught here rather than at review time. */
export const UNMATCHED_MEDIA_CSS = `
@media (min-width: 99999px) {
  .ks-card .ks-card__body { color: #00ff00; font-size: 40px; }
}
@supports (display: nonsense-value) {
  .ks-card .ks-card__body { color: #00ff00; }
}
`;

/** The same shape with a true condition. Pairs with the above: together they say
 * "flatten conditions", not "ignore conditions". */
export const MATCHED_MEDIA_CSS = `
@media (min-width: 1px) {
  .ks-card .ks-card__body { color: #5b6670; }
}
`;

export type NoiseSheetId =
  | 'chrome'
  | 'dead-utilities-small'
  | 'dead-utilities-large'
  | 'stale-stories-gen1'
  | 'stale-stories-gen4'
  | 'losing-rules'
  | 'winning-rules'
  | 'unmatched-media'
  | 'matched-media';

export function noiseSheet(id: NoiseSheetId): string {
  switch (id) {
    case 'chrome':
      return CHROME_CSS;
    case 'dead-utilities-small':
      return deadUtilities(25);
    case 'dead-utilities-large':
      return deadUtilities(400);
    case 'stale-stories-gen1':
      return staleStories(1);
    case 'stale-stories-gen4':
      return staleStories(4);
    case 'losing-rules':
      return LOSING_RULES_CSS;
    case 'winning-rules':
      return WINNING_RULES_CSS;
    case 'unmatched-media':
      return UNMATCHED_MEDIA_CSS;
    case 'matched-media':
      return MATCHED_MEDIA_CSS;
  }
}
