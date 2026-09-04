import {
  acquireDocument,
  assetsFor,
  collect,
  stabilizeForObservation,
} from '@variance-authority/dom';
import {
  awaitSuspense,
  holdingOf,
  portalContentOf,
  provenanceOf,
  wiringOf,
} from '@variance-authority/react';
import type { SuspenseSettlement } from '@variance-authority/react';
import { recipeOf } from '@variance-authority/core';
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
   * Every asset the *page* has been observed to fetch, by URL.
   *
   * Sent in whole and narrowed here, because neither side can do it alone: the
   * driver is the only party that saw the bytes, and this is the only party that
   * knows which of them the subject references. Narrowing matters most where the
   * page is shared — a Storybook run reads three hundred stories out of one
   * document, and a key built from the page's request history would depend on
   * which stories ran first, so sharding the suite would change every baseline's
   * identity.
   */
  readonly assets?: Readonly<Record<string, string>>;

  /**
   * How long to wait for the story's Suspense boundaries, in milliseconds.
   *
   * Storybook's own readiness cannot answer this. `storyRendered` fires when the
   * story function returns, and a component that suspends has returned — it is
   * the boundary above it that is showing something else. `0` waits for nothing
   * and is what a story deliberately captured mid-arrival sends.
   */
  readonly suspense?: { readonly timeoutMs?: number };

  /**
   * Read the framework wiring band. Absent means *on*.
   *
   * Absent-means-on rather than a plain boolean because the bundle's `capture`
   * entry builds its request from a `CaptureRequest`, which has no such field: a
   * band every run wants would otherwise go missing on the one surface that
   * cannot ask for it.
   */
  readonly wiring?: boolean;

  /**
   * Read held state as evidence. Absent means *off*, and that asymmetry is the
   * point rather than an oversight.
   *
   * A node carrying a holding suppresses the inert-wrapper collapse, so the same
   * story read with holdings and without hashes to two different structures.
   * That is a decision about both sides of a comparison at once, which is why
   * nothing here makes it by default.
   */
  readonly holdings?: boolean;

  /** Story mount points, tightest first. */
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
   * Whether the story had finished arriving, and what was still waiting.
   *
   * Reported rather than acted on here, for the reason every other judgement
   * leaves this file: the page can see the boundary and only the run knows
   * whether this story is one somebody declared a loading capture. What comes
   * back is the reading; `suspenseRefusal` on the driver turns it into a verdict.
   */
  readonly suspense: SuspenseSettlement;
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

export async function acquire(request: AcquireRequest): Promise<string> {
  const root = rootOf(request.roots);

  // First of everything, because it decides what the rest of it is looking at.
  // The story has rendered by Storybook's definition and may still be a
  // skeleton: a component that suspends *has* returned, and what is on screen is
  // the boundary above it. Ahead of stabilization deliberately — content that
  // arrives late brings its own images and fonts, and a `waitForImages` that ran
  // before them waited for the fallback's.
  const suspense = await awaitSuspense(root, request.suspense ?? {});

  // Before anything is read, and by default. An animation in flight moves
  // `transform` and `opacity`, both of which the semantic representation
  // carries — so an unstabilized collection reports a fade as a regression with
  // a component and a file attached. See `docs/stabilization.md`.
  const held = await stabilizeForObservation(
    root.ownerDocument,
    request.stabilize === undefined ? {} : { recipe: recipeOf(request.stabilize) },
  );

  // Narrowed to this story's own subtree before it reaches either key. See
  // `AcquireRequest.assets`.
  const assets = request.assets === undefined ? {} : assetsFor(root, request.assets);

  const shared = {
    subject: { id: request.subjectId, kind: 'story' as const },
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
    ...(request.wiring === false ? {} : { wiringOf }),
    ...(request.holdings === true ? { holdingOf } : {}),
    ...(held.digest !== undefined ? { stabilization: held.digest } : {}),
    ...(request.ignore !== undefined ? { ignore: request.ignore } : {}),
  });

  return JSON.stringify({ document, capture, stabilization: held.ids, suspense });
}

export const AGENT_VERSION = 'storybook-collector@0';
