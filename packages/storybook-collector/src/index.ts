import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCallSiteResolver, overlaySourceIndex } from '@variance-authority/core/attribute';
import { createDeclarationReader, fetchModules } from '@variance-authority/playwright';
import { createStoryRecorder } from './execution.js';
import type { StorybookCollectorOptions } from './options.js';
import { readStory, type Reading } from './read.js';
import { openWorld, type World, type WorldRecipe } from './world.js';
export type {
  Collected,
  Collector,
  CollectorConfig,
  CollectorContext,
  Plan,
  PlannedSubject,
} from './contract.js';
import type { Collected, Collector, CollectorContext, Plan, PlannedSubject } from './contract.js';
import { operatorError } from './operator.js';

/** Said in two places, because a mismatched kind can be caught at either. */
const WRONG_KIND =
  'this collector expects `subjects.kind: "storybook"`, which is what supplies the plan';
import { serveStatic, type StaticServer } from './serve.js';
import { scanSource } from './source.js';

/**
 * The Storybook collector, shipped.
 *
 * ## Why this package exists, stated as the thing it retracts
 *
 * This repository's position was that mounting is the adopter's, once, per
 * project — and it measured the cost honestly at 341 lines rather than the
 * "about thirty" the source had guessed. That position is right about React
 * applications and wrong about Storybook, for a reason the measurement itself
 * shows: of those 341 lines, the parts that were genuinely *this project's* were
 * a map of three ready selectors, a directory to scan for components, and a
 * static server. Everything else was Storybook's own contract being re-typed.
 *
 * A story index is a documented artifact. A preview owns its own mount and
 * exposes a channel for switching stories. So for this one subject source the
 * mounting problem is already solved by somebody else, and asking every adopter
 * to re-solve it was charging them for our boundary rather than for their
 * project.
 *
 * **What stays theirs.** Readiness per story, because Storybook's `storyRendered`
 * fires when the story function returns — which for a component that defers work
 * is *before the component exists*. That is knowledge about a component, and a
 * project-wide default would be a guess about all of them.
 *
 * ## What it does not make generic
 *
 * Nothing outside Storybook. A Playwright suite, a route table or a bespoke
 * mount is still a collector somebody writes — see
 * [`@variance-authority/playwright-test`](../playwright-test) for the surface
 * where the adopter's own test body plays that part instead.
 */

const STORY_ROOTS = ['#storybook-root', '#root'];

/**
 * Two candidate paths, because this module is imported from two places.
 *
 * A consumer imports `dist/index.js` and the bundle sits beside it. This
 * repository's own tests import `src/index.ts`, where it does not — and a
 * collector that only worked when nobody in the project tested it would be a
 * collector nobody in the project tested.
 */
async function pageAgentBundle(): Promise<string> {
  const candidates = [
    new URL('./page-agent.bundle.js', import.meta.url),
    new URL('../dist/page-agent.bundle.js', import.meta.url),
  ];

  for (const path of candidates) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      // Next candidate. The throw below names both, so a genuinely missing
      // bundle still fails with somewhere to look rather than a bare ENOENT.
    }
  }

  throw new Error(
    `the storybook page agent bundle is missing (looked in ` +
      `${candidates.map((path) => fileURLToPath(path)).join(' and ')}); ` +
      'it is produced by this repository’s build, not at collection time',
  );
}

/**
 * Build the module a `subjects.collector` path should default-export.
 *
 * A factory rather than a plugin: the config still names a module, the module
 * still exports a function, and the extension mechanism is unchanged. What the
 * adopter writes shrinks to the two facts only they hold.
 *
 * ```js
 * import { storybookCollector } from '@variance-authority/storybook-collector';
 *
 * export default storybookCollector({
 *   ready: { 'surface--deferred': '[data-testid="ready"]' },
 *   source: { dirs: ['src'] },
 * });
 * ```
 */
export function storybookCollector(
  options: StorybookCollectorOptions = {},
): (context: CollectorContext) => Promise<Collector> {
  return async function createCollector(context: CollectorContext): Promise<Collector> {
    const { config, plan } = context;
    const roots = options.roots ?? STORY_ROOTS;

    // Checked before anything reads it. `index` is what `subjects.kind:
    // "storybook"` supplies, so a config naming another kind arrives here with
    // nothing to serve — and the guard further down in `plan()` is too late,
    // because this line runs first.
    const index = config.subjects.index;
    if (index === undefined) throw operatorError(WRONG_KIND);

    // The build the config named, not a sibling this file assumed. Serving the
    // directory that holds the planned index is the only arrangement in which the
    // stories driven and the stories planned are guaranteed to be the same ones.
    const staticDir = dirname(index);

    if (options.baseUrl === undefined && !existsSync(join(staticDir, 'index.json'))) {
      throw operatorError(
        `${staticDir} has no index.json; build the Storybook first, or point ` +
          '`baseUrl` at one that is already served',
      );
    }

    const source = options.source === undefined ? undefined : scanSource(process.cwd(), options.source);

    // What each story executed, if anybody asked. The index it feeds is the one
    // the Vitest seam writes: same probe recipe, same block ordinals, one index
    // across every origin.
    const recorder =
      options.tests === undefined || options.tests === false
        ? undefined
        : await createStoryRecorder(index, options.tests === true ? {} : options.tests);
    const bundle = await pageAgentBundle();

    let served: StaticServer | undefined;
    if (options.baseUrl === undefined) served = await serveStatic(staticDir);
    const baseUrl = options.baseUrl ?? served!.baseUrl;

    // The recipe both worlds are built from, written down once.
    //
    // `collectAlone` opens its world from this same value, which is what makes
    // "identical except for isolation" a property of the code rather than a
    // discipline two call sites keep by hand: the viewport, the fonts, the
    // bundle, the preview address and the network options cannot differ between
    // the two worlds, because there is only one of each. See `world.ts`.
    //
    // Pointed at the preview, so `collectStory` finds itself already there and
    // does not navigate: one navigation for a whole run is the saving ADR-0009
    // rests on, and it is easiest to keep by never taking a second one. The
    // isolated world opens on the same address for a second reason — the preview
    // shell is not a subject, so landing on it is not something having run first.
    const recipe: WorldRecipe = {
      harness: {
        url: `${baseUrl}/iframe.html`,
        bundle,
        viewport: config.viewport,
        ...(config.fonts !== undefined ? { fonts: config.fonts } : {}),
        ...(options.headless !== undefined ? { headless: options.headless } : {}),
      },
      // Installed in `prepare`, which runs before the first navigation: an
      // observation that starts afterwards has already missed the assets the
      // preview loaded on its way up, and a URL nobody saw is a hole in the key.
      ...(options.network === false
        ? {}
        : {
            network: {
              ...(config.blank !== undefined ? { blank: config.blank } : {}),
              ...(options.hashAssets !== undefined ? { hashAssets: options.hashAssets } : {}),
            },
          }),
    };

    let world: World;
    try {
      world = await openWorld(recipe);
    } catch (error) {
      await served?.close();
      throw error;
    }

    // Every input to a `Collected` that is not the world, computed once and
    // handed to both readings — so the only thing that differs between a shared
    // collection and an isolated one is what else has run.
    const reading: Reading = {
      config,
      options,
      baseUrl,
      roots,
      ...(source !== undefined ? { source } : {}),
    };

    // One per run, not one per story. Every story in a Storybook is written in
    // the same handful of modules, so the second story onward resolves its call
    // sites out of this cache without a single fetch. Built over the run's own
    // page, because an isolated world is closed before anyone could ask it for a
    // frame — and it would resolve the same modules from the same server anyway.
    const callSites = createCallSiteResolver(fetchModules(world.page));

    // Asked of the engine, laid over the scan. The scan answers names it found in
    // the configured directories; the engine answers the functions this page
    // rendered, and where the two name the same component the engine's file is
    // the one that ran. Read after each subject so the union grows with the run.
    //
    // The run's reader, not the only one. What the engine has met is a fact
    // about the page it met them in: a name registered by an earlier subject
    // stays in this registry for the rest of the run, so an isolated reading
    // laid over it would carry what else has run — the one thing it exists to
    // leave out. `collectAlone` reads the engine of the world it opened.
    const declared = createDeclarationReader(world.page);
    async function withDeclared(collected: Collected, reader = declared): Promise<Collected> {
      if (!collected.ok) return collected;
      const engine = await reader.read();
      if (Object.keys(engine).length === 0) return collected;
      return { ...collected, source: overlaySourceIndex(collected.source ?? {}, engine) };
    }

    return {
      async plan(): Promise<Plan> {
        if (plan === undefined) {
          throw operatorError(WRONG_KIND);
        }
        return plan;
      },

      async collect(planned: PlannedSubject): Promise<Collected> {
        return withDeclared(await readStory(world, reading, planned, recorder));
      },

      /**
       * The same reading, out of a world nothing else has touched.
       *
       * A fresh browser, a fresh context and a fresh page on the same preview,
       * showing this story and no other. Everything else is held identical by
       * construction: the world comes from the same {@link WorldRecipe} the run
       * was opened with, and the reading from the same {@link Reading} — same
       * viewport, same fonts, same ready selector, same ignore rules, same
       * wiring and holdings, same suspense budget, same roots, same source
       * index, and the same static server, so every asset URL and therefore the
       * environment key is the one the shared world produced.
       *
       * That last one is why the server is reused rather than restarted. A
       * second server answers on a second port, every asset URL moves, the key
       * moves with it, and the run gets `incomparable` back — a clean collection
       * that cannot be compared to the dirty one settles nothing.
       *
       * The cost is a browser launch per subject, which is why `alone.limit`
       * exists and why the run only spends it on subjects it already called
       * `changed`.
       */
      async collectAlone(planned: PlannedSubject): Promise<Collected> {
        const alone = await openWorld(recipe);
        // This world's engine. The run's reader has met every function every
        // earlier subject rendered, and would lay all of them over this reading.
        const declaredAlone = createDeclarationReader(alone.page);
        try {
          return await withDeclared(await readStory(alone, reading, planned), declaredAlone);
        } finally {
          // Always, including after a throw. A world left open is a browser
          // process and a port held for the rest of the run, and the run is
          // still going: this is called per changed subject, up to `alone.limit`
          // of them.
          await declaredAlone.close();
          await alone.close();
        }
      },

      callSites,

      async close(): Promise<void> {
        await recorder?.close();
        await declared.close();
        // Only the run's own world. An isolated one is opened and closed inside
        // `collectAlone`, so there is never a second world alive at this point.
        await world.close();
        await served?.close();
      },
    };
  };
}

export type { StorybookCollectorOptions } from './options.js';
export type { StoryExecutionOptions } from './execution.js';
export type { SourceScan } from './source.js';
export type { AcquireRequest, Acquired } from './page-agent.js';
