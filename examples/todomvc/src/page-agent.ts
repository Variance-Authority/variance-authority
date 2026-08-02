/**
 * todomvc's page agent: the browser half of the persistent harness.
 *
 * `@variance-authority/playwright` keeps one Chromium alive and moves two
 * plain strings across the bridge. It does not know what a story is. This file
 * supplies that, mirroring `examples/kitchen-sink/src/page-agent.ts`.
 *
 * It installs **two** methods where kitchen-sink installs one, and the second is
 * there for the sake of a fair measurement rather than for convenience:
 *
 * - `capture` collects a `RawCapture` — the semantic arm's input.
 * - `render` only mounts and measures — the pixel arm's input.
 *
 * A pixel arm driven through `capture` would be charged for a semantic
 * collection no pixel differ performs, and the wall-clock comparison would be a
 * fabrication. Both go through the same `renderStory` the JSDOM tests use, so the
 * two arms observe the same render and a disagreement cannot be blamed on the
 * fixtures.
 */

import { collect } from '@variance-authority/dom';
// The `/agent` entry point rather than the package root: the root exports
// `createHarness`, which imports Playwright, which does not bundle for a browser.
import type { CaptureRequest, PageAgent } from '@variance-authority/playwright/agent';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import { MUTATIONS, mutationById, type Mutation, type MutationId } from './mutations.js';
import { renderStory, type Rendered } from './render.js';
import { clearProbeSheets, renderProbe, type ProbeState } from './pixel/probes.js';
import {
  BASELINE_VARIANT,
  PROBE_PREFIX,
  type RenderRequest,
  type RenderResult,
  type TodoPageAgent,
} from './pixel/protocol.js';

const SUBJECT_CONTAINER = 'subject';

/**
 * `renderStory` commits through `act`, and `act` outside a test environment logs
 * an error on every single render.
 *
 * Under Vitest that flag is set for us; in a real browser it is not, so a run of
 * 126 screenshots produced 126 console errors and the harness's `pageErrors`
 * check — the thing that would tell us a story failed to mount — became useless
 * noise. Setting the flag is what React documents for a non-Vitest act
 * environment, and it changes no render: `act` still flushes synchronously, it
 * just stops complaining that nobody told it it was allowed to.
 *
 * Set here rather than in `render.tsx` so the JSDOM half keeps Vitest's own
 * value and both arms in this page get the same one.
 */
(globalThis as unknown as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

/**
 * What is currently mounted, kept so the *next* mount can tear it down.
 *
 * Torn down on the way in rather than on the way out, so that after a run the
 * last story is still on screen — the only affordance a headed debugging session
 * has, and the pixel arm is the one arm where looking at the thing is the whole
 * point.
 */
let mounted: { readonly rendered: Rendered; readonly host: HTMLElement } | null = null;

function container(): HTMLElement {
  const element = document.getElementById(SUBJECT_CONTAINER);
  if (element === null) throw new Error(`missing #${SUBJECT_CONTAINER} container`);
  return element;
}

function dispose(): void {
  if (mounted === null) return;
  mounted.rendered.unmount();
  mounted.host.remove();
  mounted = null;
}

function isProbeState(value: string): value is ProbeState {
  return value === 'before' || value === 'after';
}

function isMutationId(value: string): value is MutationId {
  return MUTATIONS.some((mutation) => mutation.id === value);
}

function mutationFor(variant: string): Mutation | undefined {
  // `baseline` is not a mutation id, and must not be: the golden image is the
  // absence of an edit, and inventing an empty mutation for it would let a
  // future no-op mutation silently become the baseline.
  if (variant === BASELINE_VARIANT) return undefined;
  if (!isMutationId(variant)) throw new Error(`unknown variant: ${variant}`);
  return mutationById(variant);
}

/**
 * Mount `(subject, variant)` into a fresh host and return the host.
 *
 * A fresh host per mount, not a reused one. The subject's box position is part of
 * what both arms observe, and a container that accumulated a stale attribute or
 * an empty text node would move every rect — and every pixel — without any code
 * changing.
 */
function mount(subject: string, variant: string): HTMLElement {
  const parent = container();
  dispose();

  const host = document.createElement('div');
  parent.appendChild(host);

  if (subject.startsWith(PROBE_PREFIX)) {
    if (!isProbeState(variant)) throw new Error(`probe variant must be before|after: ${variant}`);
    mounted = { rendered: renderProbe(host, subject.slice(PROBE_PREFIX.length), variant), host };
    return host;
  }

  // A probe sheet left in the document would give this story a stroke width it
  // never declared. `renderStory` only clears its own marker, so this is the one
  // place that can clear the other.
  clearProbeSheets(document);

  const mutation = mutationFor(variant);
  mounted = {
    rendered: renderStory(host, subject, mutation ? { mutation } : {}),
    host,
  };
  return host;
}

function render(request: RenderRequest): string {
  mount(request.subject, request.variant);

  // The `#subject` box rather than the host's: it is what the runner clips the
  // screenshot to, so reporting anything else would let a zero-height shot fail
  // in Playwright instead of here, with no story id attached.
  const rect = container().getBoundingClientRect();
  const result: RenderResult = {
    subject: request.subject,
    variant: request.variant,
    width: rect.width,
    height: rect.height,
  };
  return JSON.stringify(result);
}

function capture(request: CaptureRequest): string {
  const host = mount(request.subject, request.variant);

  const raw = collect(host, {
    subject: { id: request.subjectId, kind: 'fixture' },
    viewport: request.viewport,
    engine: request.engine,
    portalsOf: portalContentOf,
    provenanceOf,
    ...(request.fonts ? { fonts: request.fonts } : {}),
    ...(request.features ? { features: request.features } : {}),
    ...(request.assets ? { assets: request.assets } : {}),
  });

  return JSON.stringify(raw);
}

const agent: TodoPageAgent = { capture, render, version: 'todomvc@0' };

(window as unknown as Record<string, PageAgent>)[AGENT_GLOBAL] = agent;
