import {
  acquireDocument,
  assetsFor,
  collect,
  stabilizeForObservation,
} from '@variance-authority/dom';
import { awaitSuspense, portalContentOf, provenanceOf } from '@variance-authority/react';
import type { SuspenseSettlement } from '@variance-authority/react';
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

  /**
   * How long to wait for the subject's Suspense boundaries, in milliseconds.
   *
   * The wire is settled by the driver before this runs, which is a different
   * question: a request that has completed is not a component that has rendered,
   * and between the two sit a promise, a retry and a commit. `0` waits for
   * nothing and is what a subject deliberately captured mid-arrival sends.
   */
  readonly suspense?: { readonly timeoutMs?: number };

  /** Subject roots, tightest first. */
  readonly roots: readonly string[];
}

export interface Acquired {
  readonly document: RenderDocument;
  readonly capture: RawCapture;

  /**
   * Tricks actually applied before the subject was read, by id.
   *
   * Sent back rather than assumed, because what the driver asked for and what
   * the page could do are different lists: the recipe is filtered by the tier
   * the host can observe. A run that printed its *request* would be declaring
   * something that may not have happened, which is the failure contract 2 exists
   * to prevent — and this is the one alteration the tool makes to somebody
   * else's page.
   */
  readonly stabilization: readonly string[];

  /**
   * Whether the subject had finished arriving, and what was still waiting.
   *
   * Reported rather than acted on here, for the reason every other judgement
   * leaves this file: the page can see the boundary and only the run knows
   * whether this subject is one somebody declared a loading capture. What comes
   * back is the reading; `suspenseRefusal` on the driver turns it into a verdict.
   */
  readonly suspense: SuspenseSettlement;
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

  // First of everything, because it decides what the rest of it is looking at.
  // The driver has already settled the wire, which is a different fact: a
  // response that arrived is not a component that rendered, and between them sit
  // a promise, a retry and a commit. Ahead of stabilization deliberately —
  // content that arrives late brings its own images and fonts, and a
  // `waitForImages` that ran before them waited for the skeleton's.
  const suspense = await awaitSuspense(root, request.suspense ?? {});

  // Before anything is read, and by default. An animation in flight moves
  // `transform` and `opacity`, both of which the semantic representation
  // carries — so an unstabilized collection reports a fade as a regression with
  // a component and a file attached. See `docs/stabilization.md`.
  const held = await stabilizeForObservation(
    root.ownerDocument,
    request.stabilize === undefined ? {} : { recipe: recipeOf(request.stabilize) },
  );

  // Narrowed to this route's own subtree, and handed to **both** keys. The
  // document's key is the one `settle` reads: a document that omitted the assets
  // would produce the digest the baseline was painted from even after a logo's
  // bytes moved, and the run would skip the render and report `unchanged` — the
  // exact false verdict hashing the bytes was added to close.
  const assets = request.assets === undefined ? {} : assetsFor(root, request.assets);

  const shared = {
    subject: { id: request.subjectId, kind: 'route' as const },
    viewport: request.viewport,
    ...(request.fonts !== undefined ? { fonts: request.fonts } : {}),
    ...(Object.keys(assets).length > 0 ? { assets } : {}),
  };

  // The style index is built once and handed to both, which is not only a
  // saving: two indexes built either side of a lazily-inserted `<style>` would
  // describe two different documents, and the run would compare an image of one
  // against the names of the other.
  const document = { ...acquireDocument(root, shared), baseUrl: root.ownerDocument.baseURI };
  const capture = collect(root, {
    ...shared,
    engine: request.engine,
    portalsOf: portalContentOf,
    provenanceOf,
    ...(held.digest !== undefined ? { stabilization: held.digest } : {}),
    ...(request.ignore !== undefined ? { ignore: request.ignore } : {}),
  });

  return JSON.stringify({ document, capture, stabilization: held.ids, suspense });
}

export const AGENT_VERSION = 'route-collector@0';
