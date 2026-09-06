import { AGENT_GLOBAL, type CaptureRequest } from '@variance-authority/playwright/agent';
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

async function acquireFor(request: CaptureRequest): Promise<string> {
  return await acquire({
    subjectId: request.subjectId,
    viewport: request.viewport,
    engine: request.engine,
    ...(request.fonts !== undefined ? { fonts: request.fonts } : {}),
    roots: DEFAULT_ROOTS,
  });
}

(globalThis as unknown as Record<string, unknown>)[AGENT_GLOBAL] = {
  version: AGENT_VERSION,
  declared,
  acquire: (request: AcquireRequest) => acquire(request),
  capture: async (request: CaptureRequest) =>
    JSON.stringify(JSON.parse(await acquireFor(request)).capture),
};
