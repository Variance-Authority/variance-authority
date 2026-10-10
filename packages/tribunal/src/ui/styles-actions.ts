/**
 * The bar under a subject, and the key hints on its buttons.
 *
 * Its own module because it holds one position the rest of the sheet does not:
 * the bar is laid out in the space the page leaves, never over it. A bar drawn
 * over the bottom of the picture hides the last rows of a capture, which on a
 * full-page render is the footer — and a moved footer is a change somebody
 * approved without seeing.
 */
export const ACTION_STYLES = `
.va-subject-panes { display: flex; flex: 1; min-height: 0; min-width: 0; }
.va-actionbar { align-items: center; background: var(--va-surface); border-top: 1px solid var(--va-line); display: flex; flex: none; flex-wrap: wrap; gap: 0.6rem 1.2rem; justify-content: space-between; min-width: 0; padding: 0.6rem 1rem; }
.va-scope { align-items: baseline; display: flex; flex: 1 1 14rem; font-size: 0.82rem; gap: 0.7rem; min-width: 0; white-space: nowrap; }
.va-scope b { font-family: var(--va-mono); font-size: 0.8rem; font-weight: 600; min-width: 4rem; overflow: hidden; text-overflow: ellipsis; }
.va-scope span { color: var(--va-ink-2); flex: none; }
.va-scope .va-scope-label { color: var(--va-ink-3); font-size: 0.66rem; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; }
.va-actionbar-acts { align-items: center; display: flex; flex: 0 1 auto; flex-wrap: wrap; gap: 0.4rem; min-width: 0; }
.va-actionbar-acts button { align-items: center; display: inline-flex; font-weight: 600; gap: 0.45rem; white-space: nowrap; }
.va-actionbar-acts .va-approve { background: var(--va-good); border-color: var(--va-good); color: #ffffff; }
.va-actionbar-acts .va-approve:disabled { background: var(--va-sunken); border-color: var(--va-line-firm); color: var(--va-ink-3); }
.va-actionbar-acts .va-next:not(:disabled) { background: var(--va-accent); border-color: var(--va-accent); color: var(--va-accent-ink); }
.va-actionbar-gap { background: var(--va-line); height: 1.4rem; width: 1px; }
.va-actionbar-acts .va-keys { color: var(--va-ink-3); font-weight: 500; }
.va-actionbar kbd { border: 1px solid currentColor; border-radius: 4px; font-family: var(--va-mono); font-size: 0.64rem; font-weight: 500; line-height: 1; opacity: 0.7; padding: 0.12rem 0.3rem; }
`;
