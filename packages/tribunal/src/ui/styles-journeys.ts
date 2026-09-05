/**
 * The journey grid: a family's stories across, the regions that split them down.
 *
 * A cell is one glyph, and the glyph is the whole finding: a filled mark where
 * a story entered, a hollow one where it did not, a dot where it never had the
 * module. Colour follows the glyph rather than replacing it, so the grid reads
 * the same in print, and the sentence a pointer rests on is on the cell.
 */
export const JOURNEY_STYLES = `
.va-journey-scroll { overflow-x: auto; }
.va-journey-grid { border-collapse: collapse; font-size: 0.8rem; margin: 0.35rem 0 0.2rem; }
.va-journey-grid th, .va-journey-grid td { padding: 0.18rem 0.55rem; text-align: left; vertical-align: baseline; }
.va-journey-grid th:first-child { padding-left: 0; }
.va-journey-grid thead th { color: var(--va-ink); font-family: var(--va-mono); font-weight: 600; letter-spacing: 0; text-align: center; text-transform: none; vertical-align: bottom; white-space: nowrap; }
.va-journey-grid thead th small { color: var(--va-ink-3); display: block; font-family: var(--va-sans); font-size: 0.68rem; font-weight: 400; }
.va-journey-file th { border-top: 1px solid var(--va-line); color: var(--va-ink-3); font-weight: 400; padding-top: 0.5rem; }
.va-journey-grid tbody th[scope="row"] { font-weight: 400; white-space: nowrap; }
.va-journey-grid tbody th[scope="row"] .va-note { font-size: 0.75rem; }
.va-journey-cell { font-size: 0.95rem; line-height: 1; text-align: center; }
.va-journey-cell.va-entered { color: var(--va-accent); }
.va-journey-cell.va-missed { color: var(--va-ink-2); }
.va-journey-cell.va-absent { color: var(--va-ink-3); }

.va-journey-unentered { margin-top: 0.9rem; }
.va-journey-unentered > summary { color: var(--va-ink-2); cursor: pointer; font-size: 0.8rem; padding: 0.35rem 0; }
.va-journey-unentered[open] > summary { color: var(--va-ink); }
.va-journey-rows { list-style: none; margin: 0.2rem 0 0.6rem; padding: 0; }
.va-journey-rows li { font-size: 0.8rem; margin: 0.15rem 0; }
`;
