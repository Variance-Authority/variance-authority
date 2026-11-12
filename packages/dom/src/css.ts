/**
 * CSS applicability pruning — ADR-0003 steps 1–3.
 *
 * This is the step that cannot live in `core`, because deciding whether a rule
 * applies requires asking a live DOM. It is also the step the headline claim
 * rests on: a Storybook canvas carries Storybook's own chrome CSS, the preview
 * reset, the entire design system, and a CSS-in-JS `<style>` tag that has been
 * accreting a rule for every story rendered since page load. Digesting that
 * means an unrelated component's CSS edit invalidates every baseline in the
 * repository.
 *
 * Everything matching nothing inside the subject is dropped here, before `core`
 * ever sees it.
 *
 * The work is in two files, split by how often each half runs: `css-index`
 * flattens the document's sheets once per environment, `css-match` answers once
 * per element, and `selector-parts` holds the string surgery both need. This
 * module is the door they are reached through, so the pair can be rearranged
 * without moving anybody's import.
 */

export { conditionKey, indexStyleSheets } from './css-index.js';
export type { IndexedRule, StyleIndex } from './css-index.js';

export { matchRulesFor } from './css-match.js';
export type { MatchResult } from './css-match.js';
