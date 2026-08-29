import type { Page } from 'playwright';
import { AGENT_GLOBAL } from './agent.js';
import type { NetworkObservation } from './network.js';

/**
 * Call the page agent, over an asset set the page has finished asking for.
 *
 * Both shipped collectors reach the browser through this one function, and the
 * reason it exists rather than each of them writing the `page.evaluate` is the
 * ordering problem below, which neither of them can see from where they stand.
 *
 * ## The wire moves while the page is being held still
 *
 * `EnvironmentInputs.assets` is assembled from two halves that live on opposite
 * sides of the bridge: the driver is the only party that saw an asset's bytes,
 * and the page is the only party that knows which of them its own subtree
 * references. So the driver sends its whole observed map in, and the page
 * narrows it.
 *
 * The trouble is *when*. Stabilization runs inside the acquire — after the map
 * has crossed — and stabilization fetches: `wait-for-images` asks for every
 * image the browser had deferred, precisely because a deferred image is one the
 * browser has decided not to request. Those requests are made after the driver
 * took its snapshot, so a first reading of a page with lazy images is keyed on a
 * strict subset of that page's own assets, and the key claims a page that has
 * nine pictures in it.
 *
 * It is worse than an incomplete key, because the missing half arrives a moment
 * later and stays. Read the same standing page again — which is exactly what
 * `--flakes` does — and the map now holds all twenty, so the second reading's
 * environment digest differs from the first's. Nothing about the page changed;
 * the run reads its own stabilization as a page that will not render the same
 * way twice, and reports a subject as unstable for having images below the fold.
 *
 * ## So: let the wire stop, and read again if it moved
 *
 * Once, and only when the map actually changed. The second acquire stabilizes a
 * page that is already stable — every image it would ask for has arrived — so a
 * third reading could differ only if the application is fetching on a timer,
 * which is a fact about the application and is the thing an unstable verdict is
 * for. Bounding it here would otherwise trade a false instability for a loop.
 *
 * A page with no lazy images and no late fetch pays one comparison of two maps.
 *
 * Returns the agent's JSON **string**, unparsed: each collector has its own
 * `Acquired` shape, and a shared parse would need a shared one.
 */
export async function acquireFromAgent<Request extends object>(
  page: Page,
  network: NetworkObservation | undefined,
  request: Request,
): Promise<string> {
  const observed = (): Readonly<Record<string, string>> =>
    network === undefined ? {} : { ...network.assets };

  const acquire = async (assets: Readonly<Record<string, string>>): Promise<string> => {
    const payload: readonly [string, object] = [
      AGENT_GLOBAL,
      { ...request, ...(Object.keys(assets).length > 0 ? { assets } : {}) },
    ];

    return page.evaluate(([global, sent]: readonly [string, object]) => {
      const agent = (
        globalThis as unknown as Record<string, { acquire(r: object): Promise<string> }>
      )[global];
      if (agent === undefined) throw new Error(`missing page agent ${global}`);
      return agent.acquire(sent);
    }, payload);
  };

  const sent = observed();
  const first = await acquire(sent);

  if (network === undefined) return first;

  await network.settle();
  const settled = observed();

  return sameAssets(sent, settled) ? first : acquire(settled);
}

/** Whether two asset maps would produce the same key. */
function sameAssets(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(before);
  if (keys.length !== Object.keys(after).length) return false;
  return keys.every((url) => before[url] === after[url]);
}
