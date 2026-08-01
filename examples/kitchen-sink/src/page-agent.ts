/**
 * The corpus's page agent: the browser half of the persistent harness.
 *
 * `@variance-authority/harness-playwright` knows how to keep a browser alive and
 * move plain data across the bridge. It does not know what a subject is. This
 * file supplies that, and it is the only place in the corpus that runs
 * exclusively in a real engine.
 *
 * Critically it reaches the fixtures through the same {@link renderCase} the
 * JSDOM measurement uses. P4 asks whether the two profiles agree on what both can
 * observe; if they rendered through different entry points, a disagreement could
 * always be blamed on the fixtures, and the measurement would answer nothing.
 */

import { collect } from '@variance-authority/collector-dom';
// The `/agent` entry point rather than the package root: the root exports
// `createHarness`, which imports Playwright, which does not bundle for a browser.
import type { CaptureRequest, PageAgent } from '@variance-authority/harness-playwright/agent';
import { AGENT_GLOBAL } from '@variance-authority/harness-playwright/agent';
import { portalContentOf, provenanceOf } from '@variance-authority/provenance-react';
import { renderCase, type RenderedCase } from './render.js';
import { SUBJECT_IDS, type SubjectId } from './subjects.js';
import { VARIANT_IDS, type VariantId } from './variants.js';

const SUBJECT_CONTAINER = 'subject';

/**
 * The case currently mounted, kept so the *next* capture can tear it down.
 *
 * Torn down on the way in rather than on the way out so that after a run the last
 * subject is still on screen — the only affordance a headed debugging session
 * has. Everything document-level (`renderCase`'s sheets, the portal host) goes
 * with it; a leaked noise sheet would make the next subject's `hash-stable`
 * verdict vacuous, which is the exact confound ADR-0003 exists to remove and the
 * one risk a shared document introduces.
 */
let mounted: { readonly rendered: RenderedCase; readonly host: HTMLElement } | null = null;

function isSubject(value: string): value is SubjectId {
  return (SUBJECT_IDS as readonly string[]).includes(value);
}

function isVariant(value: string): value is VariantId {
  return (VARIANT_IDS as readonly string[]).includes(value);
}

function dispose(): void {
  if (mounted === null) return;
  mounted.rendered.unmount();
  mounted.host.remove();
  mounted = null;
}

function capture(request: CaptureRequest): string {
  if (!isSubject(request.subject)) throw new Error(`unknown subject: ${request.subject}`);
  if (!isVariant(request.variant)) throw new Error(`unknown variant: ${request.variant}`);

  const container = document.getElementById(SUBJECT_CONTAINER);
  if (container === null) throw new Error(`missing #${SUBJECT_CONTAINER} container`);

  dispose();

  // A fresh host per capture, not a reused one. The subject's box position is
  // part of what `chromium` observes, and a container that accumulated a stale
  // attribute or an empty text node would move every rect in the subject without
  // any code changing.
  const host = document.createElement('div');
  container.appendChild(host);

  const rendered = renderCase(host, request.subject, request.variant);

  const raw = collect(rendered.container, {
    subject: { id: request.subjectId, kind: 'fixture' },
    viewport: request.viewport,
    engine: request.engine,
    portalsOf: portalContentOf,
    provenanceOf,
    ...(request.fonts ? { fonts: request.fonts } : {}),
    ...(request.features ? { features: request.features } : {}),
    ...(request.assets ? { assets: request.assets } : {}),
    // `profile` is deliberately not passed. `collect` probes the host for a
    // layout engine, so this run also checks that the probe answers `chromium`
    // here and `jsdom` there — the branch ADR-0002 depends on is exercised
    // rather than asserted.
  });

  mounted = { rendered, host };

  return JSON.stringify(raw);
}

const agent: PageAgent = { capture, version: 'kitchen-sink@0' };

(window as unknown as Record<string, PageAgent>)[AGENT_GLOBAL] = agent;
