/**
 * The head of a render with its verdict, the bar under it, and the key hints.
 *
 * Its own module because it holds one position the rest of the sheet does not:
 * both are laid out in the space the page leaves, never over it. A bar drawn over
 * the bottom of the picture hides the last rows of a capture, which on a
 * full-page render is the footer — and a moved footer is a change somebody
 * approved without seeing.
 */
export const ACTION_STYLES = `
.va-subject-panes { display: flex; flex: 1; min-height: 0; min-width: 0; }
.va-subject-head { align-items: center; background: var(--va-surface); border-bottom: 1px solid var(--va-line); display: flex; flex: none; flex-wrap: wrap; gap: 0.4rem 0.7rem; min-width: 0; padding: 0.6rem 1rem; }
.va-subject-head h3 { min-width: 0; overflow-wrap: anywhere; }
.va-subject-decision { align-items: center; display: flex; flex-wrap: wrap; gap: 0.4rem 0.6rem; justify-content: flex-end; margin-left: auto; min-width: 0; }
.va-subject-decision button { font-weight: 600; white-space: nowrap; }
.va-subject-decision .va-approve { background: var(--va-good); border-color: var(--va-good); color: #ffffff; }
.va-subject-decision .va-approve:disabled { background: var(--va-sunken); border-color: var(--va-line-firm); color: var(--va-ink-3); }
.va-subject-decision .va-note, .va-subject-decision .va-decision { margin: 0; }
.va-subject-says { flex: none; padding: 0 1rem; }
.va-subject-says > * { margin: 0.5rem 0; }
.va-actionbar { align-items: center; background: var(--va-surface); border-top: 1px solid var(--va-line); display: flex; flex: none; flex-wrap: wrap; gap: 0.6rem 1.2rem; justify-content: space-between; min-width: 0; padding: 0.6rem 1rem; }
.va-actionbar-acts { align-items: center; display: flex; flex: 0 1 auto; flex-wrap: wrap; gap: 0.4rem; min-width: 0; }
.va-actionbar-acts button { align-items: center; display: inline-flex; font-weight: 600; gap: 0.45rem; white-space: nowrap; }
.va-actionbar-acts .va-next:not(:disabled) { background: var(--va-accent); border-color: var(--va-accent); color: var(--va-accent-ink); }
.va-actionbar-acts .va-num { color: var(--va-ink-2); font-size: 0.82rem; margin-right: 0.3rem; white-space: nowrap; }
.va-actionbar-acts .va-keys { color: var(--va-ink-3); font-weight: 500; }
.va-actionbar kbd { border: 1px solid currentColor; border-radius: 4px; font-family: var(--va-mono); font-size: 0.64rem; font-weight: 500; line-height: 1; opacity: 0.7; padding: 0.12rem 0.3rem; }
`;
