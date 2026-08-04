import { acquireDocument, collect } from '@variance-authority/dom';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import type { RawCapture, RenderDocument, Viewport } from '@variance-authority/core';

/**
 * The browser half, shipped rather than written by each adopter.
 *
 * This is the file the design said could not be generic, and most of it was
 * right: mounting a project's components needs the project's bundle, its
 * providers and its own idea of settled. What makes Storybook the exception is
 * that it *already solved that* — the preview owns the mount, and the collector's
 * remaining job is to read a subtree that is already on screen. Nothing here
 * knows what a `Button` is.
 *
 * `acquire` returns both products of **one** mount. Two mounts would be two
 * renders, and any disagreement between the image and the names attached to it
 * would be a story about which of them was looking at what.
 */

export interface AcquireRequest {
  readonly subjectId: string;
  readonly viewport: Viewport;
  readonly engine: string;
  readonly fonts?: readonly string[];
  /** Story mount points, tightest first. */
  readonly roots: readonly string[];
}

export interface Acquired {
  readonly document: RenderDocument;
  readonly capture: RawCapture;
}

/**
 * The story's own mount point, never the preview body.
 *
 * Storybook's chrome — the preview reset, the addon layout, the error overlay —
 * lives outside `#storybook-root`, so acquiring from the root element is what
 * keeps it out of the subject. Nothing here holds a denylist for it, and that is
 * ADR-0003 working: a rule that matches nothing inside the subtree is pruned
 * because it matches nothing, not because somebody listed it.
 */
function rootOf(selectors: readonly string[]): Element {
  for (const selector of selectors) {
    const found = window.document.querySelector(selector);
    if (found !== null) return found;
  }
  throw new Error(`no story root among ${selectors.join(', ')}`);
}

export function acquire(request: AcquireRequest): string {
  const root = rootOf(request.roots);

  const shared = {
    subject: { id: request.subjectId, kind: 'story' as const },
    viewport: request.viewport,
    ...(request.fonts !== undefined ? { fonts: request.fonts } : {}),
  };

  // The style index is built once and handed to both, which is not only a
  // saving: two indexes built either side of a lazily-inserted `<style>` would
  // describe two different documents, and the run would compare an image of one
  // against the names of the other.
  const document = acquireDocument(root, shared);
  const capture = collect(root, {
    ...shared,
    engine: request.engine,
    portalsOf: portalContentOf,
    provenanceOf,
  });

  return JSON.stringify({ document, capture });
}

export const AGENT_VERSION = 'storybook-collector@0';
