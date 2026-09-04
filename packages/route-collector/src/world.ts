import {
  createHarness,
  observeNetwork,
  type Harness,
  type HarnessOptions,
  type NetworkObservation,
  type NetworkOptions,
} from '@variance-authority/playwright';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';

/**
 * The world a route is read out of, and the recipe that builds one.
 *
 * Split out of `index.ts` for `collectAlone`. A route run navigates per subject
 * — that is what a route is — so it does not share a *document* between
 * subjects the way a Storybook run does. It shares everything above the
 * document: the browser process, the context, its cookie jar, its origins'
 * `localStorage`, `sessionStorage`, IndexedDB, caches and service workers. All
 * of those survive a navigation, and a route whose render depends on one of them
 * renders differently because another route ran first.
 *
 * The recipe is a value rather than a procedure so both worlds are opened by
 * this one function from the same object: the viewport, the fonts, the bundle
 * and the network options are not merely equal between the two, they are the
 * same fields of the same value. A field that drifted would have to drift in
 * both.
 */

export interface RouteWorldRecipe {
  /**
   * Everything `createHarness` needs, except the hook this module owns.
   *
   * `prepare` is excluded because the network observation has to be installed
   * before the first navigation and this is the file that knows it — a caller
   * free to supply its own hook could open the two worlds with two different
   * observers, which is the one difference that would look exactly like
   * pollution.
   */
  readonly harness: Omit<HarnessOptions, 'prepare'>;

  /**
   * How to watch the wire, or nothing to leave it unwatched.
   *
   * Absent is `network: false`, and it belongs to the recipe rather than being
   * defaulted here: a world that watched the wire compared against one that did
   * not would produce two different environment keys and report `incomparable`
   * where the run asked about order.
   */
  readonly network?: NetworkOptions;
}

export interface RouteWorld {
  readonly page: Harness['page'];

  /** The engine string that goes into every subject's key, from the browser itself. */
  readonly engine: string;

  /** Absent exactly when {@link RouteWorldRecipe.network} was. */
  readonly network?: NetworkObservation;

  /**
   * Put the page agent back if the last navigation discarded it.
   *
   * A route run navigates per subject, and a navigation throws away injected
   * scripts. Tracked by *navigation* rather than by address: a run that reads one
   * route at two widths goes to the same URL twice, and a check on the address
   * alone would decide the agent was still there after a load that discarded it
   * — which surfaces as an evaluate error naming a missing global rather than as
   * anything a reader could act on.
   */
  ensureAgent(): Promise<void>;

  close(): Promise<void>;
}

/**
 * Launch a browser, open a page, and watch what it is served.
 *
 * The whole world: a fresh browser process, a fresh context and a fresh page.
 * Not a fresh *context* on the running browser, which would be cheaper and would
 * be answering a smaller question — a leak through a shared browser process is
 * rarer than a leak through a shared origin and it is the harder one to find by
 * hand, so the reading that costs a launch is the one worth having.
 */
export async function openWorld(recipe: RouteWorldRecipe): Promise<RouteWorld> {
  let network: NetworkObservation | undefined;

  const harness = await createHarness({
    ...recipe.harness,
    ...(recipe.network === undefined
      ? {}
      : {
          prepare: async (page): Promise<void> => {
            network = await observeNetwork(page, recipe.network as NetworkOptions);
          },
        }),
  });

  const page = harness.page;
  let agentInstalled = false;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) agentInstalled = false;
  });

  return {
    page,
    engine: harness.engine,
    ...(network !== undefined ? { network } : {}),

    async ensureAgent(): Promise<void> {
      if (agentInstalled) return;

      // Reinstalled and its presence checked rather than assumed. An absent
      // agent surfaces as a named failure here instead of as an inscrutable
      // evaluate error.
      await page.addScriptTag({ content: recipe.harness.bundle });
      const installed = await page.evaluate(
        (global: string) =>
          typeof (globalThis as unknown as Record<string, unknown>)[global] === 'object',
        AGENT_GLOBAL,
      );
      if (!installed) throw new Error(`the page bundle did not install ${AGENT_GLOBAL}`);
      agentInstalled = true;
    },

    async close(): Promise<void> {
      await network?.close();
      await harness.close();
    },
  };
}
