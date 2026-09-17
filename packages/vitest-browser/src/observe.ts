import type { SubjectRef, Viewport } from '@variance-authority/core/format';
import { stabilizeForObservation } from '@variance-authority/dom';
import {
  awaitSuspense,
  digestPass,
  holdingOf,
  provenanceOf,
  suspenseRefusal,
  wiringOf,
} from '@variance-authority/react';
import { capture } from '@variance-authority/unit-test/capture';
import { expect } from 'vitest';
import { OBSERVE_COMMAND, type Observed, type ObserveRequest, type Sensitivity } from './protocol.js';

/**
 * The half that runs in the tab.
 *
 * What makes this surface cheap is that the test body already is the collector:
 * `render(<Button />)` has mounted the subject and the locators have waited for
 * it. What is left is to read the mount — once, for both the document and the
 * semantic snapshot — and hand it to the process that owns the baseline.
 *
 * Nothing here compares anything, and nothing here touches a disk. The tab has
 * no baseline to compare against and no browser to paint a document with, which
 * is the whole reason `./node` exists.
 */

/**
 * A mounted subject: a DOM element, or anything that resolves to one.
 *
 * Typed structurally rather than against Vitest's `Locator`, because that is
 * all this needs and a type import would pin this package to one minor of a
 * runner whose locator is `element()` in every version that has one. A
 * `render()` result's `container`, its `locator`, and a bare element are all
 * accepted by the same signature.
 */
export interface LocatedSubject {
  element(): Element;
}

export type VarianceSubject = Element | LocatedSubject;

export interface VarianceOptions {
  /**
   * What the baseline is keyed on. Defaults to the running test's full name.
   *
   * A default derived from the test name means renaming a test orphans its
   * baseline, which is the right failure — `new` rather than a silent
   * comparison against something else — and is still worth overriding for
   * anything long-lived.
   */
  readonly subjectId?: string;

  /** Defaults to `fixture`, which is what a mounted component is. */
  readonly subjectKind?: SubjectRef['kind'];

  /**
   * Fonts this machine is asserted to have, as `family/weight/style/hash`.
   *
   * Omitted here it stays omitted rather than being guessed: a page can see
   * that `Inter` is in use and not which Inter, and a substitution moves every
   * rect without moving a line of code.
   */
  readonly fonts?: readonly string[];

  /** Environment facts folded into the capture and into media-condition resolution. */
  readonly features?: Readonly<Record<string, string>>;

  /** The root component paths are made relative to, so `file:line` survives the trip. */
  readonly sourceRoot?: string;

  /** Milliseconds to wait for the subject's Suspense boundaries. Defaults to 5000. */
  readonly suspenseTimeoutMs?: number;

  /**
   * This subject's *loading* state is what is being captured.
   *
   * Without it, a subtree still showing a Suspense fallback **throws** rather
   * than being recorded. `await expect.element(x).toBeVisible()` passes against
   * a skeleton, so a baseline over one that was never meant to be a skeleton
   * turns every faster machine into a regression.
   */
  readonly loading?: boolean;

  /** Read the framework wiring of each node — props, context, hook cells, keys. Defaults to `true`. */
  readonly wiring?: boolean;

  /**
   * Read the held state behind each node. Defaults to `false`.
   *
   * Opt-in rather than symmetric with `wiring`, because it changes what a
   * structure hash is: a node carrying a holding suppresses the inert-wrapper
   * collapse, so the same subject read with holdings and without produces two
   * different structures, and both sides of a comparison must be read the same
   * way.
   */
  readonly holdings?: boolean;

  /** How much of this subject is asserted on, when it has been relaxed. */
  readonly sensitivity?: Sensitivity;
}

/** Sends one request to the Node half and returns what it answered. */
export type Deliver = (request: ObserveRequest) => Promise<Observed>;

/**
 * Observe one mounted subject against its stored baseline.
 *
 * ```ts
 * const screen = await render(<Button>Save</Button>);
 * assertUnchanged(await variance(screen.container));
 * ```
 */
export async function variance(
  target: VarianceSubject,
  options: VarianceOptions = {},
): Promise<Observed> {
  return await observeSubject(target, options, throughCommands);
}

/**
 * The same observation with the transport handed in.
 *
 * Exported because the transport is the one part of this file that cannot run
 * outside a browser-mode run, and everything above it — settlement, refusal,
 * stabilization, capture — is the part worth holding a test over.
 */
export async function observeSubject(
  target: VarianceSubject,
  options: VarianceOptions,
  deliver: Deliver,
): Promise<Observed> {
  const root = elementOf(target);
  const subject: SubjectRef = {
    id: options.subjectId ?? subjectFromRunner(),
    kind: options.subjectKind ?? 'fixture',
  };

  // First of everything, because it decides what the rest of this is looking
  // at. Content that arrives late brings its own images and fonts, and a
  // stabilization that ran before it held the fallback still.
  const settlement = await awaitSuspense(
    root,
    options.loading === true
      ? { timeoutMs: 0 }
      : options.suspenseTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.suspenseTimeoutMs },
  );
  const unsettled = suspenseRefusal(settlement, {
    subjectId: subject.id,
    declaredLoading: options.loading === true,
  });
  if (unsettled !== undefined) throw new Error(unsettled);

  // On by default. An animation in flight moves `transform` and `opacity`, both
  // of which the semantic representation carries, so an unstabilized reading
  // reports a fade as a regression with a component and a file attached.
  const held = await stabilizeForObservation(root.ownerDocument);

  // One memo for this reading: `provenanceOf` walks the owner chain of every
  // node, so without it each boundary's props are digested once per descendant.
  const pass = digestPass();

  const artifact = await capture(root, {
    subject,
    viewport: viewportOf(root.ownerDocument),
    ...(options.fonts === undefined ? {} : { fonts: options.fonts }),
    ...(options.features === undefined ? {} : { features: options.features }),
    ...(options.sourceRoot === undefined ? {} : { sourceRoot: options.sourceRoot }),
    resolveResource: fetchResource,
    provenanceOf: (element) => provenanceOf(element, undefined, pass),
    ...(options.wiring === false ? {} : { wiringOf }),
    ...(options.holdings === true ? { holdingOf } : {}),
    ...(held.digest === undefined ? {} : { stabilization: held.digest }),
  });

  // TODO: portalled content is not read here. `portalContentOf` finds the
  // subtrees React rendered outside this element — a dialog, a tooltip, a
  // toast — and `capture` has no seam to take them through, so a subject whose
  // interesting half is in a portal is captured without it.

  return await deliver({
    artifact: { ...artifact, stabilization: held.ids },
    ...(options.sensitivity === undefined ? {} : { sensitivity: options.sensitivity }),
  });
}

/** Throw what the Node half would print, for a suite that asserts without a matcher. */
export function assertUnchanged(observed: Observed): void {
  if (observed.verdict !== 'unchanged') throw new Error(observed.message);
}

/** A matcher function suites may compose into an `expect` they already own. */
export function toBeUnchanged(observed: Observed) {
  return {
    pass: observed.verdict === 'unchanged',
    message: () => observed.message,
  };
}

function elementOf(target: VarianceSubject): Element {
  if (typeof (target as LocatedSubject).element === 'function') {
    return (target as LocatedSubject).element();
  }
  return target as Element;
}

/**
 * The subject id the runner supplies when an observation does not name one.
 *
 * Refused rather than defaulted: an id is the coordinate a baseline is stored
 * at, and inventing one from a counter would give the same subject a different
 * address on every run.
 */
function subjectFromRunner(): string {
  const name = expect.getState().currentTestName;
  if (name === undefined || name === '') {
    throw new Error(
      'variance needs a subject id and this run has none; ' +
        'pass `subjectId`, or call it from inside a test',
    );
  }
  return name;
}

/**
 * The size the subject was laid out in, read from the window it was laid out in.
 *
 * `window.innerWidth` rather than the browser tab's viewport: a browser-mode
 * test runs inside an iframe the orchestrator sizes, and every media query the
 * subject resolved was resolved against this frame.
 */
function viewportOf(document: Document): Viewport {
  const view = document.defaultView;
  if (view === null) {
    throw new Error(
      'variance needs a viewport and this document has none; ' +
        'a detached document has no declared size, so no two runs are comparable',
    );
  }
  const dark = view.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  return {
    width: view.innerWidth,
    height: view.innerHeight,
    deviceScaleFactor: view.devicePixelRatio === 0 ? 1 : view.devicePixelRatio,
    colorScheme: dark ? 'dark' : 'light',
  };
}

/**
 * Close the document over its resources with the page's own `fetch`.
 *
 * The dev server that served the subject is the one that serves its images, and
 * the tab is already authenticated to it in whatever way the application is. A
 * response the server refuses is recorded as absent rather than throwing: a
 * fixture pointing an `<img>` at a path nobody serves is testing the fallback,
 * and the subject is the broken state.
 */
async function fetchResource(
  url: string,
): Promise<{ contentType: string; bytes: Uint8Array } | { absent: true; status: number }> {
  const response = await fetch(url);
  if (!response.ok) return { absent: true, status: response.status };
  return {
    contentType: response.headers.get('content-type') ?? '',
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

async function throughCommands(request: ObserveRequest): Promise<Observed> {
  // A literal specifier, because Vite rewrites this one and cannot rewrite a
  // computed one. The cast is the version seam: the module exists in every
  // release that has browser mode, and `commands` is what it has been called
  // since the protocol was named.
  const module = (await import('vitest/browser')) as unknown as {
    readonly commands?: Readonly<Record<string, ((request: ObserveRequest) => Promise<Observed>) | undefined>>;
  };
  const command = module.commands?.[OBSERVE_COMMAND];
  if (command === undefined) {
    throw new Error(
      `the \`${OBSERVE_COMMAND}\` command is not registered; ` +
        'add `variancePlugin()` from `@variance-authority/vitest-browser/node` to the Vitest config',
    );
  }
  return await command(request);
}
