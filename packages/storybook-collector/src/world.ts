import {
  createObservedHarness,
  type Harness,
  type HarnessOptions,
  type NetworkObservation,
  type NetworkOptions,
} from '@variance-authority/playwright';

/**
 * The world a story is read out of, and the recipe that builds one.
 *
 * Split out of `index.ts` for `collectAlone`. A run holds **one** world open for
 * every story in it (ADR-0009) and that is the saving the whole tool rests on;
 * the price is that story B can differ because story A ran first, and a
 * comparison cannot tell that apart from a regression. Settling it means reading
 * the subject again with nothing else in the world — which is only evidence if
 * the second world differs from the first in *isolation and nothing else*.
 *
 * So the recipe is a value, not a procedure. Both worlds are opened by this one
 * function from the same {@link WorldRecipe}, which makes "identical except for
 * isolation" structural rather than a promise two call sites keep by hand: the
 * viewport, the fonts, the context options, the `prepare` hook, the navigation
 * and the agent installation are not merely equal, they are the same code
 * reading the same object. A field that drifted would have to drift in both.
 */

export interface WorldRecipe {
  /**
   * Everything `createHarness` needs, except the hook `createObservedHarness` owns.
   *
   * `prepare` is excluded because the network observation has to be installed
   * before the first navigation and `createObservedHarness` installs it — a caller
   * free to supply its own hook could open the two worlds with two different
   * observers, which is the one difference that would look exactly like
   * pollution.
   */
  readonly harness: Omit<HarnessOptions, 'prepare'>;

  /**
   * How to watch the wire, or nothing to leave it unwatched.
   *
   * Absent is `network: false` — a real position for a build whose asset URLs
   * carry their own content hash — and it has to be a property of the recipe
   * rather than a default here, because a world that watched the wire compared
   * against one that did not would produce two different environment keys and
   * blame the wire for every change where the run asked about order.
   */
  readonly network?: NetworkOptions;
}

export interface World {
  readonly page: Harness['page'];

  /** The engine string that goes into every subject's key, from the browser itself. */
  readonly engine: string;

  /** The timezone and locale the page was opened in, as they go into every subject's key. */
  readonly region: Harness['region'];

  /** Absent exactly when {@link WorldRecipe.network} was. */
  readonly network?: NetworkObservation;

  /**
   * The driver tricks applied before the first navigation, which hold for
   * every reading after it: nothing but this world moves the pointer.
   *
   * The ids go to the page agent, which keeps the driver tricks it was told
   * about and drops the rest, so a reading's recipe is the one that held.
   */
  readonly driven: readonly string[];

  close(): Promise<void>;
}

/**
 * Open a page on the preview, and watch what it is served.
 *
 * A run's worlds are pages in one browser and one context: the browser is
 * leased, and the context is shared because it holds the HTTP cache, so a
 * worker's preview boots from what the first world already fetched. A recipe
 * whose harness asks for `isolated` gets the whole world instead — a fresh
 * browser process, a fresh context and a fresh page. Not a fresh *context* on
 * the running browser, which would be cheaper and would be answering a smaller
 * question — a leak through a shared browser process is rarer than a leak
 * through a shared document and it is the harder one to find by hand, so the
 * reading that costs a launch is the one worth having.
 */
export async function openWorld(recipe: WorldRecipe): Promise<World> {
  const { harness, network } = await createObservedHarness(recipe.harness, recipe.network);

  return {
    page: harness.page,
    engine: harness.engine,
    region: harness.region,
    ...(network !== undefined ? { network } : {}),
    driven: harness.driven,
    async close(): Promise<void> {
      try {
        await network?.close();
      } finally {
        await harness.close();
      }
    },
  };
}
