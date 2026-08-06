import { acquireDocument, collect, stabilizeForObservation } from '@variance-authority/dom';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import { recipeOf } from '@variance-authority/core';
import type { RawCapture, RenderDocument, Viewport } from '@variance-authority/core';

/**
 * The browser half for a route, which is the cheapest mount there is.
 *
 * The design's position was that mounting is the adopter's, because a project's
 * components need its bundle, its providers and its own idea of settled. A route
 * is the case where all three are already true before anything here runs: the
 * application served it, so it mounted itself. What is left is reading a subtree
 * that is on screen — and nothing here knows what a `Button` is.
 *
 * `acquire` returns both products of **one** read. Two would be two renders, and
 * any disagreement between the image and the names attached to it would be a
 * story about which of them was looking at what.
 */

export interface AcquireRequest {
  readonly subjectId: string;
  readonly viewport: Viewport;
  readonly engine: string;
  readonly fonts?: readonly string[];

  /**
   * Content hashes for what the page was served, keyed by request URL.
   *
   * Observed by the driver and sent *in*, because only the driver saw the bytes
   * and only the page assembles the environment key. A URL is not an identity:
   * the same `url(...)` resolves to different bytes the day somebody re-exports
   * a logo, and without this the run compares the two as `unchanged`.
   */
  readonly assets?: Readonly<Record<string, string>>;

  /**
   * Subtrees this run excludes, as `(rule id, selector)` pairs (spec 0024).
   *
   * Carried into the page because a selector needs a document, and the document
   * is here. What comes back is a *mark* on the capture, never a deletion — the
   * counts downstream must be able to say that a difference was absorbed rather
   * than that it never happened.
   */
  readonly ignore?: readonly { readonly id: string; readonly select: string }[];
  /**
   * Stabilization tricks to hold the page still with, by id.
   *
   * Absent means `COLLECT_RECIPE` — the default is *on*, because a suite that
   * has to ask for determinism is a suite that discovers it needed it from a
   * red build. Ids rather than interventions because this value crosses a
   * `page.evaluate`, and a trick with a `settle` step is a closure that does
   * not survive the trip; the page holds the same registry and resolves them.
   */
  readonly stabilize?: readonly string[];

  /** Subject roots, tightest first. */
  readonly roots: readonly string[];
}

export interface Acquired {
  readonly document: RenderDocument;
  readonly capture: RawCapture;
}

/**
 * The subject's root, never the whole page.
 *
 * A route's document holds a header, a nav and a footer that are not the subject,
 * and comparing all of it means every page moves when the nav does. Bounding the
 * subtree is also what makes pruning affordable — 1007 rules parsed, 1 reached
 * the normalizer, and that ratio is a property of a *bounded* subject. `body` is
 * accepted and is the caller saying the page is the subject.
 */
function rootOf(selectors: readonly string[]): Element {
  for (const selector of selectors) {
    const found = window.document.querySelector(selector);
    if (found !== null) return found;
  }
  throw new Error(`no story root among ${selectors.join(', ')}`);
}

export async function acquire(request: AcquireRequest): Promise<string> {
  const root = rootOf(request.roots);

  // Before anything is read, and by default. An animation in flight moves
  // `transform` and `opacity`, both of which the semantic representation
  // carries — so an unstabilized collection reports a fade as a regression with
  // a component and a file attached. See `docs/stabilization.md`.
  const held = await stabilizeForObservation(
    root.ownerDocument,
    request.stabilize === undefined ? {} : { recipe: recipeOf(request.stabilize) },
  );

  const shared = {
    subject: { id: request.subjectId, kind: 'route' as const },
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
    ...(request.assets !== undefined ? { assets: request.assets } : {}),
    portalsOf: portalContentOf,
    provenanceOf,
    ...(held.digest !== undefined ? { stabilization: held.digest } : {}),
    ...(request.ignore !== undefined ? { ignore: request.ignore } : {}),
  });

  return JSON.stringify({ document, capture });
}

export const AGENT_VERSION = 'route-collector@0';
