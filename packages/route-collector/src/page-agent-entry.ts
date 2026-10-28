import { AGENT_GLOBAL, type CaptureRequest } from '@variance-authority/playwright/agent';
import { tapCommits, type CommitTap } from '@variance-authority/react';
import { AGENT_VERSION, acquire, declared, type AcquireRequest } from './page-agent.js';

/**
 * The bundle's entry point, and the only module here with a side effect.
 *
 * It installs at `AGENT_GLOBAL` because `createHarness` refuses a bundle that
 * does not — a check worth keeping, since a broken bundle otherwise surfaces as
 * a timeout with no cause. So the object satisfies `PageAgent` *and* carries the
 * `acquire` a collector needs.
 *
 * The two are not the same call. `PageAgent.capture` answers the semantic tiers
 * and returns a capture; a collector additionally needs the `RenderDocument` the
 * raster tier paints, from the same mount. `capture` is implemented in terms of
 * `acquire` rather than beside it, so there is no arrangement in which the two
 * read different DOM.
 */

/**
 * The default when a caller names none. Deliberately the whole body: a route with
 * no declared root is the caller saying the page *is* the subject, and guessing a
 * container selector would silently observe a fraction of it.
 */
const DEFAULT_ROOTS = ['body'] as const;

/**
 * React's commit stream for this document, tapped once.
 *
 * The bundle runs twice in a route's document: as an init script, added
 * before the world's first navigation and so ahead of every document's own
 * scripts, and again as a script tag once the route has loaded. Only the first
 * can install the hook `react-dom` binds when its module body runs, so the tap
 * is made there and the second run takes it rather than wrapping the hook a
 * second time. A document whose React loaded before the hook was installed
 * makes the tap refuse rather than report a page that never commits;
 * `awaitHydration` then reads it as no tap at all: it waits on React's lanes
 * and the wire, and neither waits for passive effects nor compares the markup
 * hydration changed.
 */
const TAP_GLOBAL = '__variance_authority_route_commits__';
const scope = globalThis as unknown as Record<string, unknown>;
const tap = (scope[TAP_GLOBAL] ??= tapCommits({ keep: 64 })) as CommitTap;

async function acquireFor(request: CaptureRequest): Promise<string> {
  return await acquire(tap, {
    subjectId: request.subjectId,
    viewport: request.viewport,
    engine: request.engine,
    ...(request.fonts !== undefined ? { fonts: request.fonts } : {}),
    ...(request.timezoneId !== undefined ? { timezoneId: request.timezoneId } : {}),
    ...(request.locale !== undefined ? { locale: request.locale } : {}),
    roots: DEFAULT_ROOTS,
  });
}

(globalThis as unknown as Record<string, unknown>)[AGENT_GLOBAL] = {
  version: AGENT_VERSION,
  declared,
  acquire: (request: AcquireRequest) => acquire(tap, request),
  capture: async (request: CaptureRequest) =>
    JSON.stringify(JSON.parse(await acquireFor(request)).capture),
};
