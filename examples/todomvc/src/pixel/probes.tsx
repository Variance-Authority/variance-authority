import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { TOKENS_CSS } from '../tokens/foundation.js';
import { DS_CSS } from '../ds/styles.js';

/**
 * Blind-spot probes: renders where the *pixel* arm is the one that can see.
 *
 * The rest of this example is built to show a semantic layer beating a pixel
 * differ. A comparison that only ever tested that direction would be an
 * advertisement, so these three fixtures are constructed the other way round —
 * each is a real, user-visible change that leaves the semantic snapshot's render
 * hash untouched, and each names the specific reason.
 *
 * They deliberately do **not** join `STORIES`. The head-to-head is scored on the
 * fourteen stories and the eight mutations in `mutations.ts`; adding a case that
 * one arm is guaranteed to win would change the corpus rather than measure it.
 * These run as their own pass and are reported as their own finding.
 *
 * The three holes, in increasing order of how fixable they are:
 *
 * 1. **Raster content that is not markup.** A `<canvas>` carries its bitmap in a
 *    context, not in the DOM, so two documents that are attribute-identical can
 *    paint different pictures. Nothing in a snapshot of the tree can reach it.
 *    Not a gap in the allowlist — a gap in the *observable*.
 * 2. **Properties outside `STYLE_ALLOWLIST`.** `accent-color` repaints a native
 *    control; `-webkit-text-stroke-width` thickens every glyph. Both are declared
 *    by rules that genuinely match subject nodes, and both are dropped by
 *    `admits` because the allowlist does not list them. This one is a one-line
 *    fix per property, and the probe exists so the list of missing properties is
 *    discovered by measurement rather than by a bug report.
 */

export type ProbeState = 'before' | 'after';

export interface Probe {
  readonly id: string;
  /** Why a reviewer would care that this changed. */
  readonly intent: string;
  /** Which of the two holes above this one demonstrates. */
  readonly hole: 'not-in-dom' | 'not-in-allowlist';
  /** CSS appended after the design system, as a mutation sheet would be. */
  readonly css?: (state: ProbeState) => string | undefined;
  readonly render: (state: ProbeState) => ReactNode;
  /** Imperative post-mount painting, for content React does not own. */
  readonly paint?: (container: HTMLElement, state: ProbeState) => void;
}

export const PROBES: readonly Probe[] = [
  {
    id: 'canvas-repaint',
    hole: 'not-in-dom',
    intent: 'The sparkline now plots the other series. Same element, different bitmap.',
    render: () => <canvas className="probe-canvas" width={200} height={80} />,
    paint(container, state) {
      const canvas = container.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('probe canvas did not mount');

      const context = canvas.getContext('2d');
      if (context === null) throw new Error('probe canvas has no 2d context');

      // Opaque fill first: a transparent canvas would composite against the page
      // and make the probe partly a test of the page background instead of of
      // the bitmap.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.strokeStyle = state === 'before' ? '#2d6cdf' : '#cf3b3b';
      context.lineWidth = 3;
      context.beginPath();

      const series = state === 'before' ? [10, 40, 20, 60, 30, 70] : [70, 30, 60, 20, 40, 10];
      series.forEach((value, index) => {
        const x = (index / (series.length - 1)) * (canvas.width - 6) + 3;
        const y = canvas.height - value;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });

      context.stroke();
    },
  },
  {
    id: 'accent-color',
    hole: 'not-in-allowlist',
    intent: 'Rebrand missed the native controls: checked checkboxes still paint the old blue.',
    // Declared on a class that matches the subject node itself, not on `:root`.
    // Applicability pruning would drop a `:root` rule for reaching nothing, and
    // then the probe would be measuring pruning rather than the allowlist.
    css: (state) => `.probe-check { accent-color: ${state === 'before' ? '#2d6cdf' : '#b5179e'}; }`,
    render: () => (
      <input className="probe-check" type="checkbox" checked readOnly aria-label="Probe" />
    ),
  },
  {
    id: 'text-stroke',
    hole: 'not-in-allowlist',
    intent: 'A faux-bold stroke was added to body copy. Every glyph in the product got heavier.',
    css: (state) =>
      state === 'before'
        ? undefined
        : '.probe-text { -webkit-text-stroke-width: 0.6px; -webkit-text-stroke-color: currentColor; }',
    render: () => <p className="va-text probe-text">Prove the tiering, ship the docket.</p>,
  },
];

export function probeById(id: string): Probe {
  const probe = PROBES.find((candidate) => candidate.id === id);
  if (!probe) throw new Error(`unknown probe: ${id}`);
  return probe;
}

/**
 * Probe sheets carry their own marker so that switching between a probe and a
 * story cannot leak style either way.
 *
 * `renderStory` removes `[data-todomvc-sheet]` on the way in and knows nothing
 * about these, so the page agent removes them explicitly. A leaked probe sheet
 * would give the *next* story a stroke width it never declared, and the symptom
 * would be a story that "changed" under an unrelated mutation.
 */
const PROBE_SHEET_MARKER = 'data-todomvc-probe-sheet';

const ROOTS = new WeakMap<HTMLElement, Root>();

export interface RenderedProbe {
  readonly container: HTMLElement;
  unmount(): void;
}

export function renderProbe(
  container: HTMLElement,
  probeId: string,
  state: ProbeState,
): RenderedProbe {
  const probe = probeById(probeId);
  const document = container.ownerDocument;

  clearProbeSheets(document);
  // Same order as `renderStory`: tokens, design system, then the edit last, so a
  // same-specificity override wins on document order.
  append(document, 'tokens', TOKENS_CSS);
  append(document, 'design-system', DS_CSS);
  const css = probe.css?.(state);
  if (css !== undefined) append(document, `probe:${probe.id}`, css);

  let root = ROOTS.get(container);
  if (!root) {
    root = createRoot(container);
    ROOTS.set(container, root);
  }

  act(() => root!.render(probe.render(state)));
  // After the commit, never inside it: `paint` reaches for a live element, and
  // React has only put one in the document once `act` has flushed.
  probe.paint?.(container, state);

  return {
    container,
    unmount(): void {
      act(() => root!.render(null));
    },
  };
}

export function clearProbeSheets(document: Document): void {
  for (const existing of Array.from(document.querySelectorAll(`[${PROBE_SHEET_MARKER}]`))) {
    existing.remove();
  }
}

function append(document: Document, name: string, css: string): void {
  const style = document.createElement('style');
  style.setAttribute(PROBE_SHEET_MARKER, name);
  style.textContent = css;
  document.head.appendChild(style);
}
