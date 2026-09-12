/**
 * The panel that argues a change: what the run found, and what absorbed it.
 *
 * Its own module because it is the one part of the sheet whose rules decide what
 * a reviewer reads *first* and what they have to open to read at all. The lead
 * is loud, the method line is a note, the rest of the findings are folded behind
 * a count, and every declaration is a row including the ones that absorbed
 * nothing — those last are the finding. A rule here that is wrong does not make
 * the page ugly; it makes a reviewer stop before the sentence that would have
 * changed their decision.
 *
 * The ledger rules travel with the findings rather than with the tables they are
 * drawn as, because `.va-tag` is declared here and spent in both: a split that
 * put them in two modules would put a base rule and its modifier in two files
 * whose concatenation order decides whether the modifier applies.
 *
 * Concatenated into {@link REVIEW_STYLES} rather than shipped separately, on the
 * same argument as every other half of that sheet: the operator is handed one
 * string.
 */
export const FINDING_STYLES = `
/* One finding, in three registers: what it is, where it is, and the sentence
   that explains it. The rule id is last because it is the least of the three to
   a person and the whole of it to an ignore list.

   The lead is the only loud thing in the panel and it is one sentence about this
   change. The method line that used to open the panel is now the last line in it,
   at note size: it says why nothing here moved the verdict, which is worth
   knowing and is worth nobody's first glance. */
.va-findings-lead { font-size: 0.9rem; font-weight: 650; margin-bottom: 0.7rem; }
.va-findings-lead.va-findings-mine { color: var(--va-warn-ink); }
.va-findings-why { border-top: 1px solid var(--va-line); margin-top: 0.9rem; padding-top: 0.5rem; }
/* Shut by default, and the summary is the whole argument for the fold: a count a
   reviewer can decide to open, rather than twenty-two rows they have to scroll. */
.va-findings-rest { margin-top: 1rem; }
.va-findings-rest > summary { color: var(--va-ink-2); cursor: pointer; font-size: 0.8rem; padding: 0.35rem 0; }
.va-findings-rest[open] > summary { color: var(--va-ink); }
.va-findings-rest > .va-note { margin-bottom: 0.7rem; }
.va-findings-band + .va-findings-band { margin-top: 0.9rem; }
.va-band-head { color: var(--va-ink-2); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.09em; margin-bottom: 0.5rem; text-transform: uppercase; }
.va-findings { display: grid; gap: 0.7rem; }
.va-finding { border-left: 2px solid var(--va-line-firm); padding-left: 0.7rem; }
.va-finding-new { border-left-color: var(--va-warn); }
/* The headline is an item and the marks may wrap under it. Left as a bare text
   node beside two flex-none badges it became an anonymous item with nothing
   holding its width, and "a control inside another control" read down the rail
   one word to a line. */
.va-finding-title { align-items: baseline; display: flex; flex-wrap: wrap; font-size: 0.88rem; font-weight: 650; gap: 0.5rem; justify-content: space-between; }
.va-finding-said { flex: 1 1 9rem; }
.va-finding-marks { align-items: baseline; display: flex; flex: none; gap: 0.45rem; }
.va-times { color: var(--va-accent); flex: none; font-family: var(--va-mono); font-size: 0.72rem; font-weight: 500; }
.va-age { border-radius: 5px; color: var(--va-ink-3); flex: none; font-size: 0.7rem; font-weight: 500; padding: 0.1rem 0.4rem; white-space: nowrap; }
.va-age-new { background: var(--va-warn-bg); color: var(--va-warn-ink); }
.va-age-standing, .va-age-undated { background: var(--va-info-bg); }
.va-finding-where { color: var(--va-ink-2); font-size: 0.8rem; }
.va-finding-what { color: var(--va-ink-2); font-size: 0.8rem; margin-top: 0.2rem; }
.va-finding-owner { align-items: center; display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.35rem; }
.va-tag { background: var(--va-surface); border: 1px solid var(--va-line); border-radius: 5px; color: var(--va-ink-2); font-size: 0.72rem; padding: 0.1rem 0.4rem; }
.va-tag.va-rule { color: var(--va-ink-3); }

/* The declaration ledgers. Every rule is a row, including the ones that absorbed
   nothing — those are the finding, and a table that hid them would be a table of
   rules that are working. The rule name is the widest column because it is the
   thing a reader copies into their config; the reason is the widest prose. */
.va-ledger { margin-top: 0.5rem; }
.va-ledger code { font-size: 0.78rem; }
.va-ledger em { color: var(--va-ink-3); font-size: 0.72rem; font-style: normal; }
.va-ledger .va-none { color: var(--va-ink-3); }
.va-ledger .va-ledger-why { color: var(--va-ink-2); width: 38%; }
.va-ledger .va-tag { margin-right: 0.25rem; }
/* Marked on the row rather than only on the badge: a reviewer scanning for the
   one rule that is wrong reads the left edge, not the third column. */
.va-ledger tr.va-spent td:first-child { border-left: 2px solid var(--va-warn); padding-left: 0.4rem; }
.va-tag.va-warn { background: var(--va-warn-bg); border-color: transparent; color: var(--va-warn-ink); }
.va-ledger-head { color: var(--va-ink-2); font-size: 0.8rem; font-weight: 650; margin-top: 0.9rem; }
.va-ledger-head .va-note { font-weight: 400; margin-left: 0.5rem; }
`;
