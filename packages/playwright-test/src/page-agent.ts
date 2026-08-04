import { acquireDocument, collect } from '@variance-authority/dom';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import type { RawCapture, RenderDocument, SubjectRef, Viewport } from '@variance-authority/core';

/**
 * The page half, bundled as an IIFE and installed on `window`.
 *
 * Same obligation as `cases/storybook-case/collector/page-agent.js` — acquire a
 * document, collect a capture, from one mount — with one difference that is most
 * of why this surface is cheaper than a collector: **the root arrives as an
 * element, not as a selector.** Playwright resolves a locator and hands the node
 * into `evaluate`, so nothing here searches for the subject, and the `rootOf`
 * fallback chain the Storybook collector needs does not exist.
 *
 * `acquire` returns a JSON **string**. Playwright would structured-clone the
 * object happily, and that would hide the property the transport story rests on:
 * a capture that picked up a `Map`, a DOM handle or a cycle has to fail at this
 * boundary rather than three hops later.
 */

/**
 * Deliberately not a `window.__va`-style short name. The agent shares a global
 * namespace with whatever application the page already loaded, and a collision
 * would be discovered as a confusing capture rather than as an error.
 */
export const AGENT = '__variance_authority_playwright_test__';

export interface AcquireRequest {
  readonly subject: SubjectRef;
  readonly viewport: Viewport;

  /** Engine identity for the environment key, e.g. `chromium@131.0.6778.33`. */
  readonly engine: string;

  /**
   * Fonts this machine is asserted to have, as `family/weight/style/hash`.
   *
   * Passed through rather than sniffed in-page: a document can see that `Inter`
   * is in use and not which Inter, and a substitution moves every rect without
   * moving a line of code.
   */
  readonly fonts?: readonly string[];
}

export interface Acquired {
  readonly document: RenderDocument;
  readonly capture: RawCapture;
}

export function acquire(root: Element, request: AcquireRequest): string {
  const shared = {
    subject: request.subject,
    viewport: request.viewport,
    ...(request.fonts !== undefined ? { fonts: request.fonts } : {}),
  };

  // One mount, two products, deliberately. Two mounts would be two renders, and
  // any disagreement between the image and the names attached to it would be a
  // story about which of them was looking at what.
  const document = acquireDocument(root, shared);
  const capture = collect(root, {
    ...shared,
    engine: request.engine,
    portalsOf: portalContentOf,
    provenanceOf,
  });

  return JSON.stringify({ document, capture });
}

export interface InstalledAgent {
  readonly acquire: (root: Element, request: AcquireRequest) => string;
  readonly version: string;
}

/**
 * Installing is a separate module (`page-agent-entry.ts`), not a side effect
 * here. This file is imported by the Node half for its types, and a module that
 * writes to `globalThis` on import would do it in a process that has no page.
 */
export const AGENT_VERSION = 'playwright-test@0';
