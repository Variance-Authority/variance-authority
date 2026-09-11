import { acquireDocument, collect, stabilizeForObservation } from '@variance-authority/dom';
import {
  awaitSuspense,
  createDeclarationRegistry,
  holdingOf,
  portalContentOf,
  provenanceOf,
  wiringOf,
} from '@variance-authority/react';
import type { DeclaredComponents, SuspenseSettlement } from '@variance-authority/react';
import { recipeOf } from '@variance-authority/core/format';
import type {
  Digest,
  RawCapture,
  RenderDocument,
  SubjectRef,
  Viewport,
} from '@variance-authority/core/format';

/**
 * The page half, bundled as an IIFE and installed on `window`.
 *
 * Same obligation as `packages/storybook-collector/src/page-agent.ts` — acquire a
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
export const ACCESSIBILITY_ROOT_ATTRIBUTE = 'data-variance-authority-accessibility-root';
let accessibilitySequence = 0;

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

  /**
   * Read the framework wiring band. Absent means *on*.
   *
   * Absent-means-on rather than a plain boolean because a suite reaches this
   * through `variance(locator)` with no options at all, and a band every run
   * wants should not be missing from the shortest call anyone writes.
   */
  readonly wiring?: boolean;

  /**
   * Read held state as evidence. Absent means *off*, and that asymmetry is the
   * point rather than an oversight.
   *
   * A node carrying a holding suppresses the inert-wrapper collapse, so the same
   * subtree read with holdings and without hashes to two different structures.
   * That is a decision about both sides of a comparison at once, which is why
   * nothing here makes it by default.
   */
  readonly holdings?: boolean;
}

export interface Acquired {
  readonly document: RenderDocument;
  readonly capture: RawCapture;
  readonly stabilization: { readonly ids: readonly string[]; readonly digest?: Digest };

  /**
   * Whether the subject had finished arriving, and what was still waiting.
   *
   * Reported rather than acted on here. The page can see the boundary; only the
   * test knows whether this subject is one somebody meant to capture mid-flight.
   */
  readonly suspense: SuspenseSettlement;
  /** Temporary portal locators used by the Node half, then removed or restored. */
  readonly accessibilityPortals: readonly {
    readonly marker: string;
    readonly previous?: string;
  }[];
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

  // FIXME: remounts are not read here, and `remountedSince` is why. It needs a
  // mark taken *before* whatever the reader wants counted; `acquire` is a single
  // call with no before, so a mark taken in this function reports nothing and a
  // reading against the mount reports every fiber on the page. The interval
  // belongs to the test body, which means the missing surface is a mark a spec
  // takes before its own action — not another field on this request.

  // One mount, two products, deliberately. Two mounts would be two renders, and
  // any disagreement between the image and the names attached to it would be a
  // story about which of them was looking at what.
  const portals = portalContentOf(root);
  const document = { ...acquireDocument(root, shared), baseUrl: root.ownerDocument.baseURI };
  const capture = collect(root, {
    ...shared,
    engine: request.engine,
    portalsOf: () => portals,
    provenanceOf: (node: Node) => provenanceOf(node, declared),
    ...(request.wiring === false ? {} : { wiringOf }),
    ...(request.holdings === true ? { holdingOf } : {}),
    ...(held.digest !== undefined ? { stabilization: held.digest } : {}),
  });

  // Mark only after both semantic products exist. The Node half needs locators
  // for portalled accessibility roots, while neither the document nor capture
  // may contain the transport marker. Existing values are restored in `finally`.
  const sequence = ++accessibilitySequence;
  const accessibilityPortals = portals.map((portal, index) => {
    const previous = portal.getAttribute(ACCESSIBILITY_ROOT_ATTRIBUTE);
    const marker = `${sequence}-${index}`;
    portal.setAttribute(ACCESSIBILITY_ROOT_ATTRIBUTE, marker);
    return { marker, ...(previous === null ? {} : { previous }) };
  });

  return JSON.stringify({
    document,
    capture,
    suspense,
    stabilization: {
      ids: held.ids,
      ...(held.digest === undefined ? {} : { digest: held.digest }),
    },
    accessibilityPortals,
  });
}

export interface InstalledAgent {
  readonly acquire: (root: Element, request: AcquireRequest) => Promise<string>;
  readonly version: string;
  /** What `createDeclarationReader` reads, keyed on `AGENT` rather than `AGENT_GLOBAL`. */
  readonly declared: DeclaredComponents;
}

/**
 * Installing is a separate module (`page-agent-entry.ts`), not a side effect
 * here. This file is imported by the Node half for its types, and a module that
 * writes to `globalThis` on import would do it in a process that has no page.
 */
/**
 * The components this bundle has met, kept for the engine to be asked where
 * each is declared (`createDeclarationReader` on the Node side). One per
 * bundle installation: the reader keys its progress on `id`, and a page that
 * installs the bundle again is a page whose functions are new objects.
 */
export const declared = createDeclarationRegistry();

export const AGENT_VERSION = 'playwright-test@0';
