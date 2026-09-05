/**
 * The journey timeline: a trunk in ink, the arm that entered a region in the
 * accent, the arm that did not dashed and dim.
 *
 * Tone follows the line's dash as well as its colour, so the picture reads the
 * same in print, and the fork numbers repeat in the list beneath it.
 */
export const JOURNEY_STYLES = `
.va-journey-scroll { overflow-x: auto; }
.va-timeline { display: block; }
.va-timeline-line { fill: none; stroke-linecap: round; stroke-width: 2; }
.va-timeline-line.va-trunk { stroke: var(--va-ink); stroke-width: 2.5; }
.va-timeline-line.va-lit { stroke: var(--va-accent); }
.va-timeline-line.va-dim { stroke: var(--va-ink-3); stroke-dasharray: 5 4; }
.va-timeline-fork circle { fill: var(--va-surface); stroke: var(--va-ink); stroke-width: 1.5; }
.va-timeline-fork .va-timeline-n { fill: var(--va-ink); font-family: var(--va-mono); font-size: 9px; font-weight: 700; }
.va-timeline-label { fill: var(--va-ink-2); font-family: var(--va-mono); font-size: 10.5px; }
.va-timeline-names { fill: var(--va-ink-2); font-family: var(--va-mono); font-size: 11.5px; }
.va-timeline-names.va-trunk { fill: var(--va-ink); font-weight: 600; }

.va-journey-forks { font-size: 0.8rem; list-style: none; margin: 0.35rem 0 0; padding: 0; }
.va-journey-forks li { display: grid; gap: 0 0.5rem; grid-template-columns: auto 1fr; margin: 0.25rem 0; }
.va-journey-forks .va-timeline-n { border: 1px solid var(--va-ink); border-radius: 50%; display: inline-block; font-family: var(--va-mono); font-size: 0.62rem; font-weight: 700; grid-row: 1; height: 1.1rem; line-height: 1.05rem; text-align: center; width: 1.1rem; }
.va-journey-forks .va-journey-region { grid-column: 2; }

.va-journey-unentered { margin-top: 0.9rem; }
.va-journey-unentered > summary { color: var(--va-ink-2); cursor: pointer; font-size: 0.8rem; padding: 0.35rem 0; }
.va-journey-unentered[open] > summary { color: var(--va-ink); }
.va-journey-rows { list-style: none; margin: 0.2rem 0 0.6rem; padding: 0; }
.va-journey-rows li { font-size: 0.8rem; margin: 0.15rem 0; }
`;
