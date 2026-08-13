import { acquireDocument, collect, stabilizeForObservation } from '@variance-authority/dom';
import { awaitSuspense, portalContentOf, provenanceOf } from '@variance-authority/react';
import type { SuspenseSettlement } from '@variance-authority/react';
import { recipeOf } from '@variance-authority/core';
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
   * A test body that has awaited its own assertions has waited for what it knows
   * to look for, and a boundary is what it does not: `expect(locator).toBeVisible()`
   * passes against a skeleton. `0` waits for nothing, which is what a
   * deliberately-captured loading state sends.
   */
  readonly suspense?: { readonly timeoutMs?: number };
}

export interface Acquired {
  readonly document: RenderDocument;
  readonly capture: RawCapture;

  /**
   * Whether the subject had finished arriving, and what was still waiting.
   *
   * Reported rather than acted on here. The page can see the boundary; only the
   * test knows whether this subject is one somebody meant to capture mid-flight.
   */
  readonly suspense: SuspenseSettlement;
}

export async function acquire(root: Element, request: AcquireRequest): Promise<string> {
  // First of everything, because it decides what the rest of it is looking at.
  // Ahead of stabilization deliberately — content that arrives late brings its
  // own images and fonts, and a `waitForImages` that ran before them waited for
  // the fallback's.
  const suspense = await awaitSuspense(root, request.suspense ?? {});

  // Before anything is read, and by default. An animation in flight moves
  // `transform` and `opacity`, both of which the semantic representation
  // carries — so an unstabilized collection reports a fade as a regression with
  // a component and a file attached. See `docs/stabilization.md`.
  const held = await stabilizeForObservation(
    root.ownerDocument,
    request.stabilize === undefined ? {} : { recipe: recipeOf(request.stabilize) },
  );

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
    ...(held.digest !== undefined ? { stabilization: held.digest } : {}),
  });

  return JSON.stringify({ document, capture, suspense });
}

export interface InstalledAgent {
  readonly acquire: (root: Element, request: AcquireRequest) => Promise<string>;
  readonly version: string;
}

/**
 * Installing is a separate module (`page-agent-entry.ts`), not a side effect
 * here. This file is imported by the Node half for its types, and a module that
 * writes to `globalThis` on import would do it in a process that has no page.
 */
export const AGENT_VERSION = 'playwright-test@0';
