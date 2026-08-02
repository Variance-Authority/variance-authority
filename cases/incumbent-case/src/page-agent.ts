/**
 * The browser half, shared by both arms.
 *
 * One bundle, one page, one mount path. The incumbent's runner reaches it
 * through the URL — it navigates and screenshots, which is all a screenshot
 * assertion can do — and our arm reaches it through the same page agent every
 * other subject in this repository uses.
 *
 * Sharing the mount is the only reason the comparison means anything. Two arms
 * rendering their own copy of a panel produce a measurement of the copies. Here a
 * disagreement can only come from what each arm *observes*, because the thing
 * observed is the same DOM produced by the same call.
 */

import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createElement } from 'react';
import { collect } from '@variance-authority/dom';
import type { CaptureRequest, PageAgent } from '@variance-authority/playwright/agent';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import { editFor, scenario, type Variant } from './scenarios.js';
import type { Locale } from './surface.js';
import { Panel } from './surface.js';

const CONTAINER = 'subject';

/** Set once the tree is committed. The incumbent's runner waits for it. */
const READY = 'caseReady';

let mounted: { readonly root: Root; readonly host: HTMLElement } | null = null;

function container(): HTMLElement {
  const element = document.getElementById(CONTAINER);
  if (element === null) throw new Error(`missing #${CONTAINER}`);
  return element;
}

/**
 * Mount `(scenario, variant)` into a fresh host inside `#subject`.
 *
 * Fresh, not reused: the subject's box position is part of what both arms
 * observe, and a host that accumulated a stale attribute or an empty text node
 * would move every rect — and every pixel — with no code having changed.
 */
export function mount(
  id: string,
  variant: Variant,
  locale: Locale = 'en',
  width?: number,
): HTMLElement {
  delete document.documentElement.dataset[READY];

  const parent = container();
  if (mounted !== null) {
    // Unmount before removing the host, so effects run their cleanup while their
    // node is still attached.
    flushSync(() => mounted!.root.unmount());
    mounted.host.remove();
    mounted = null;
  }

  const host = document.createElement('div');
  parent.appendChild(host);

  const root = createRoot(host);
  flushSync(() =>
    root.render(
      createElement(Panel, {
        ...editFor(scenario(id), variant),
        locale,
        ...(width !== undefined ? { width } : {}),
      }),
    ),
  );
  mounted = { root, host };

  document.documentElement.dataset[READY] = '1';
  return host;
}

/**
 * Mount from `?scenario=…&variant=…`, which is the only handle a screenshot
 * assertion has on this page.
 */
export function mountFromLocation(): void {
  const query = new URLSearchParams(window.location.search);
  const id = query.get('scenario');
  if (id === null) return;

  const variant = query.get('variant');
  if (variant !== 'before' && variant !== 'after') {
    throw new Error(`variant must be before|after, got ${String(variant)}`);
  }

  mount(id, variant);
}

function capture(request: CaptureRequest): string {
  // `request.subject` carries the scenario id and `request.variant` the side,
  // matching the harness's two-string bridge. A locale rides on the variant as
  // `after@de` rather than widening that bridge: the harness's contract is two
  // strings, and a third parameter added for one test is a contract changed for
  // every caller. The capture is taken from the host the mount returned rather
  // than from `#subject`, so the snapshot's root is the panel and not the clip
  // box around it.
  // `after`, `after@de`, or `after@de@300` — side, catalogue, panel width.
  const [side, locale, width] = request.variant.split('@') as [Variant, Locale | undefined, string | undefined];
  const host = mount(request.subject, side, locale ?? 'en', width === undefined ? undefined : Number(width));

  return JSON.stringify(
    collect(host, {
      subject: { id: request.subjectId, kind: 'fixture' },
      viewport: request.viewport,
      engine: request.engine,
      portalsOf: portalContentOf,
      provenanceOf,
      ...(request.fonts ? { fonts: request.fonts } : {}),
      ...(request.features ? { features: request.features } : {}),
      ...(request.assets ? { assets: request.assets } : {}),
    }),
  );
}

const agent: PageAgent = { capture, version: 'incumbent-case@0' };

(window as unknown as Record<string, PageAgent>)[AGENT_GLOBAL] = agent;
(window as unknown as Record<string, unknown>)['__CASE__'] = { mount, mountFromLocation };
