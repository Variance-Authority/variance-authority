import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCallSiteResolver, overlaySourceIndex } from '@variance-authority/core/attribute';
import { createDeclarationReader, fetchModules } from '@variance-authority/playwright';
import { operatorError } from './operator.js';
import { readRoute, type RouteReading } from './read.js';
import { scanSource } from './source.js';
import { openWorld, type RouteWorldRecipe } from './world.js';
export type {
  Collected,
  Collector,
  CollectorConfig,
  CollectorContext,
  Plan,
  PlannedSubject,
} from './contract.js';
import type { Collected, Collector, CollectorContext, Plan, PlannedSubject } from './contract.js';
export type { RouteCollectorOptions } from './options.js';
import type { RouteCollectorOptions } from './options.js';
import { declaredOnce, discover, routesFromFiles } from './sitemap.js';
import { pagesIn, serveStatic, type StaticServer } from './serve.js';
import { widthsOf } from './widths.js';

/**
 * A collector for routes: the application serves the page, this reads a subtree.
 *
 * ## Why this is the cheapest surface in the project
 *
 * Mounting is the half `variance run` declines to write, because a project's
 * components need its own bundle, its own providers and its own idea of settled.
 * A route is the case where all three are already true before anything here runs:
 * the application served it. There is no bundle to reproduce, no provider tree to
 * rebuild, and readiness is a selector the page itself attaches.
 *
 * ## It is also the arm this repository advertised and did not demonstrate
 *
 * `subjects.kind: "list"` has parsed, planned and been unit-tested since the
 * config existed, and no real suite had ever entered through it — which
 * `surface.md` called "the reverse of the usual failure and still a failure".
 * This is what enters through it.
 *
 * ## What it is not
 *
 * Not a crawler. A crawl follows what a fetched page points at, so the subject
 * list is decided by whatever shipped on Tuesday: one more link is a `new`
 * subject nobody chose and nobody can approve.
 *
 * A sitemap is a different object, and `discover` reads one. It is a list the
 * application publishes about itself — declared discovery rather than inferred —
 * and it requires `subjects.kind: "collector"` because the subject list is then
 * discovered rather than written down. That trade is the operator's: a page
 * dropped from the sitemap stops being watched with nothing to approve, which is
 * why `routes` stays the form that says who decides what is under test. The run
 * names the baselines it holds and did not plan (ADR-0063), so the removal is
 * reported — it is the *review* of it that discovery gives up. A sitemap *index* is
 * still not followed; fetching what a fetched document points at is the crawler
 * above.
 */


const DEFAULT_ROOTS = ['body'];

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
    `the route page agent bundle is missing (looked in ` +
      `${candidates.map((path) => fileURLToPath(path)).join(' and ')}); ` +
      'it is produced by this repository’s build, not at collection time',
  );
}

/**
 * Build the module a `subjects.collector` path should default-export.
 *
 * A directory of built HTML is the one collector input that needs no running
 * application: every file under it is already a subject, and the adopter is
 * left holding only the directory and which element of a page is the subject.
 *
 * ```js
 * import { routeCollector } from '@variance-authority/route-collector';
 *
 * export default routeCollector({
 *   directory: './site',
 *   roots: ['main'],
 * });
 * ```
 */
export function routeCollector(
  options: RouteCollectorOptions,
): (context: CollectorContext) => Promise<Collector> {
  return async function createCollector(context: CollectorContext): Promise<Collector> {
    const { config, plan } = context;
    const roots = options.roots ?? DEFAULT_ROOTS;
    const entries = Object.entries(options.routes ?? {});
    declaredOnce(options);

    const source = options.source === undefined ? undefined : scanSource(process.cwd(), options.source);
    const bundle = await pageAgentBundle();

    // Refused here rather than per route. A run asking for portable documents
    // with the wire switched off cannot produce one for any subject, and saying
    // so once — before a browser opens — beats saying it identically on every
    // route after paying for all of them.
    const portable = options.portable ?? false;
    if (portable && options.network === false) {
      throw operatorError(
        'portable documents need the network observer: the retained bytes are the ones the ' +
          'page was served, and `network: false` is the option that stops anyone seeing them',
      );
    }

    // The recipe the run's world is built from, written down once so
    // `collectAlone` can build a second one that differs in nothing else: same
    // viewport, same fonts, same bundle, same network options. See `world.ts`.
    //
    // The network observation is installed through `prepare`, before the
    // harness's own first navigation. Attaching afterwards would miss every asset
    // that first document pulled in, and the only repair for that is a second
    // page load — one per run, to observe the one already paid for.
    const recipe: RouteWorldRecipe = {
      harness: {
        // Somewhere to be while the agent is installed. With a discovered plan
        // there is no first route yet — the sitemap has not been fetched — so the
        // harness opens `about:blank` and the first `collect` navigates.
        url: entries[0]?.[1] ?? 'about:blank',
        bundle,
        viewport: config.viewport,
        ...(config.fonts !== undefined ? { fonts: config.fonts } : {}),
        ...(options.headless !== undefined ? { headless: options.headless } : {}),
      },
      ...(options.network === false
        ? {}
        : {
            network: {
              ...(config.blank !== undefined ? { blank: config.blank } : {}),
              ...(portable ? { retainResources: true } : {}),
              ...(options.hashAssets !== undefined ? { hashAssets: options.hashAssets } : {}),
            },
          }),
    };

    const world = await openWorld(recipe);

    // One per run, not one per route. A route's nodes come from a handful of
    // modules and the next route shares most of them, so the cache is worth more
    // the longer the run goes on. Built over the run's own page, because an
    // isolated world is closed before anyone could ask it for a frame.
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

    // Filled by `plan()` when the routes are discovered rather than declared.
    let resolved: Readonly<Record<string, string>> | undefined;
    // Held for the run's lifetime when a directory is being served, and closed
    // with the collector: a file server outliving the run holds the port.
    let served: StaticServer | undefined;

    // Everything a reading needs that is not the world, in one place so the
    // shared collection and the isolated one cannot be given different recipes.
    // A function rather than a value because `routes` is only known after
    // `plan()` for a discovered run — and both callers then read the same answer.
    const reading = (): RouteReading => ({
      config,
      options,
      routes: resolved ?? options.routes ?? {},
      roots,
      portable,
      ...(source !== undefined ? { source } : {}),
    });

    return {
      async plan(): Promise<Plan> {
        // A discovered plan, when the operator asked for one. Resolved on first
        // ask rather than at construction: a collector that fetched a sitemap
        // merely by being imported would make `variance doctor` reach the
        // network, which it states plainly that it never does.
        const from =
          options.sitemap !== undefined
            ? options.sitemap
            : options.directory !== undefined
              ? options.directory
              : undefined;

        if (from !== undefined) {
          if (options.directory !== undefined) {
            served = await serveStatic(resolve(options.directory));
            resolved = routesFromFiles(pagesIn(resolve(options.directory)), served.baseUrl);

            if (Object.keys(resolved).length === 0) {
              throw operatorError(
                `${options.directory} holds no .html file, so this run has no subjects. ` +
                  'Planning zero subjects and exiting 0 is indistinguishable from a suite that ' +
                  'passed',
              );
            }
          } else {
            resolved = await discover(from);
          }

          return widthsOf(
            {
              subjects: Object.keys(resolved).map((id) => ({
                subject: { id, kind: 'route' as const },
              })),
              notObserved: [],
              warnings: [
                `planned ${Object.keys(resolved).length} subject(s) from ${from}. ` +
                  'A page this stops listing stops being watched with no config diff to ' +
                  'approve; the run names it as a subject the baseline store holds and the ' +
                  'plan did not — declare the routes explicitly if the removal itself should ' +
                  'be reviewed',
              ],
            },
            options.widths,
            config.viewport,
          );
        }

        if (plan === undefined) {
          throw operatorError(
            'this collector expects `subjects.kind: "list"`, which is what supplies the plan — ' +
              'or `sitemap`, with `subjects.kind: "collector"`, to discover one',
          );
        }
        return widthsOf(plan, options.widths, config.viewport);
      },

      async collect(planned: PlannedSubject): Promise<Collected> {
        return withDeclared(await readRoute(world, reading(), planned));
      },

      /**
       * The same reading, out of a world nothing else has touched.
       *
       * A route run already navigates per subject, so what an isolated world
       * removes is not a shared document — it is everything above one. A cookie
       * another route set, a `localStorage` key it wrote, an IndexedDB record, a
       * service worker it registered, the HTTP cache: all of them survive a
       * navigation, and a route that reads one renders differently because
       * another route ran first. A fresh browser has none of them.
       *
       * Everything else is held identical by construction. The world comes from
       * the same {@link RouteWorldRecipe} the run was opened with and the reading
       * from the same {@link RouteReading} — including the address, which for a
       * served directory names the run's own static server, so every asset URL
       * and therefore the environment key is the one the shared world produced. A
       * second server on a second port would move all of them and the clean
       * collection would come back `incomparable`, settling nothing.
       *
       * The one recipe field that differs is where the browser lands before the
       * route is fetched: `about:blank`, never the run's first route. Opening on
       * a real route would be another subject having run first, which is the
       * exact thing this exists to exclude — and it costs nothing, because
       * `readRoute` navigates whenever the page is not already on the address.
       */
      async collectAlone(planned: PlannedSubject): Promise<Collected> {
        const alone = await openWorld({ ...recipe, harness: { ...recipe.harness, url: 'about:blank' } });
        // This world's engine. The run's reader has met every function every
        // earlier subject rendered, and would lay all of them over this reading.
        const declaredAlone = createDeclarationReader(alone.page);
        try {
          return await withDeclared(await readRoute(alone, reading(), planned), declaredAlone);
        } finally {
          // Always, including after a throw. A world left open is a browser
          // process held for the rest of the run, and the run is still going:
          // this is called per changed subject, up to `alone.limit` of them.
          await declaredAlone.close();
          await alone.close();
        }
      },

      callSites,

      async close(): Promise<void> {
        await declared.close();
        // Only the run's own world. An isolated one is opened and closed inside
        // `collectAlone`, so there is never a second world alive at this point.
        await world.close();
        // Last, and always: a file server that outlives the run holds a port,
        // and a run that produced a correct report and then hung on exit is the
        // failure `serveStatic`'s own close comment was written for.
        await served?.close();
      },
    };
  };
}

export type { SourceScan } from './source.js';
export type { AcquireRequest, Acquired } from './page-agent.js';

export { locationsIn, routesFrom, subjectIdFor } from './sitemap.js';
