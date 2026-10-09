/**
 * Stories of one component that render one image: a warned line on the docket,
 * and on the subject page a strip of small candidates with the matching ones
 * outlined.
 *
 * The tiles are small on purpose. The grid answers *which of these are one
 * picture*, and the viewer below it is where a picture is read.
 */
export const SAME_IMAGE_STYLES = `
.va-same-image { border-left: 2px solid var(--va-warn); margin: 0.9rem 0; padding-left: 0.85rem; }
.va-same-image p { color: var(--va-warn-ink); font-size: 0.88rem; margin: 0 0 0.35rem; }
.va-same-image ul { font-size: 0.82rem; list-style: none; margin: 0; padding: 0; }
.va-same-image li { margin: 0.15rem 0; }
.va-siblings { margin: 0.9rem 0 1.1rem; }
.va-siblings h4 { color: var(--va-ink-2); font-size: 0.78rem; font-weight: 600; margin: 0 0 0.35rem; }
.va-siblings > .va-note { font-size: 0.8rem; margin: 0.2rem 0; }
.va-sibling-grid { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr)); list-style: none; margin: 0.4rem 0 0; padding: 0; }
.va-sibling { border: 1px solid var(--va-line); border-radius: 7px; min-width: 0; padding: 0.3rem; }
.va-sibling > a { color: inherit; display: block; text-decoration: none; }
.va-sibling img { background: var(--va-sunken); display: block; height: 5.5rem; object-fit: contain; object-position: top center; width: 100%; }
.va-sibling-name { display: block; font-family: var(--va-mono); font-size: 0.72rem; margin-top: 0.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.va-sibling-mark { color: var(--va-warn-ink); display: block; font-size: 0.68rem; }
.va-sibling.va-sibling-same { border-color: var(--va-warn); }
.va-sibling.va-sibling-here { box-shadow: 0 0 0 2px var(--va-ink-2); }
`;
