/**
 * The concerns card on a subject page, and the count of them on a build.
 *
 * Its own module because its colours carry a rule the rest of the sheet does not
 * have to keep: a concern is never drawn in the decision's colours. An open
 * concern is warm and a resolved one is quiet, and neither is green or red,
 * because a reviewer who saw a resolved concern in the approval green would read
 * it as the baseline having been accepted — which is the one thing a concern
 * says nothing about.
 */
export const CONCERN_STYLES = `
.va-concerns { display: grid; gap: 0.7rem; }
.va-concerns .va-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0; }
.va-suspicious { border-color: var(--va-warn); color: var(--va-warn-ink); }
.va-concern { border-left: 2px solid var(--va-line-firm); display: grid; gap: 0.35rem; padding-left: 0.7rem; }
.va-concern-open { border-left-color: var(--va-warn); }
.va-concern-investigating { border-left-color: var(--va-accent); }
.va-concern > header { align-items: baseline; display: flex; gap: 0.5rem; justify-content: space-between; }
.va-concern-state { border-radius: 5px; color: var(--va-ink-3); flex: none; font-family: var(--va-mono); font-size: 0.66rem; letter-spacing: 0.06em; padding: 0.1rem 0.4rem; text-transform: uppercase; }
.va-concern-open .va-concern-state { background: var(--va-warn-bg); color: var(--va-warn-ink); }
.va-concern-investigating .va-concern-state { background: var(--va-accent-soft); color: var(--va-accent); }
.va-concern-resolved .va-concern-state { background: var(--va-info-bg); }
.va-evidence-list { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.va-evidence-list code { background: var(--va-sunken); border-radius: 5px; font-family: var(--va-mono); font-size: 0.72rem; padding: 0.1rem 0.4rem; }
.va-concern-trail { color: var(--va-ink-2); display: grid; font-size: 0.8rem; gap: 0.35rem; list-style: none; margin: 0; padding: 0; }
.va-concern-trail > li > span { color: var(--va-ink-3); font-family: var(--va-mono); font-size: 0.72rem; }
.va-concern-trail p { margin: 0.1rem 0 0; }

/* The form. Labels above their fields, so a long title is read whole. */
.va-concern-form { display: grid; gap: 0.6rem; }
.va-concern-form label { display: grid; gap: 0.2rem; }
.va-concern-form label > span, .va-concern-form legend { color: var(--va-ink-2); font-size: 0.76rem; font-weight: 600; }
.va-concern-form input:not([type="radio"]), .va-concern-form textarea, .va-concern-form select { background: var(--va-sunken); border: 1px solid var(--va-line-firm); border-radius: 7px; color: var(--va-ink); font: inherit; padding: 0.4rem 0.55rem; }
.va-concern-form fieldset { border: 0; display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0; padding: 0; }
.va-concern-form legend { margin-bottom: 0.3rem; padding: 0; width: 100%; }
.va-evidence button { font-family: var(--va-mono); font-size: 0.72rem; padding: 0.15rem 0.5rem; }
.va-evidence button.va-chosen { background: var(--va-accent-soft); border-color: var(--va-accent); color: var(--va-accent); }
.va-concern-states label { align-items: center; display: flex; font-size: 0.82rem; gap: 0.3rem; margin-right: 0.6rem; }
.va-concern-form .va-approve:not(:disabled) { border-color: var(--va-warn); color: var(--va-warn-ink); }

/* The count on a build's header: present only when something was flagged. */
.va-concern-tally { color: var(--va-ink-2); flex: none; font-size: 0.75rem; white-space: nowrap; }
.va-concern-tally b { color: var(--va-warn-ink); font-weight: 600; }
.va-concern-tally.va-unknown { color: var(--va-warn); }
`;
