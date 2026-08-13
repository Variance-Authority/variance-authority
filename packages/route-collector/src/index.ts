import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesGlob, normalize as normalizeCapture } from '@variance-authority/core';

import {
  createHarness,
  unresizable,
  observeNetwork,
  type Harness,
  type NetworkObservation,
} from '@variance-authority/playwright';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { suspenseRefusal } from '@variance-authority/react';
import type { AcquireRequest, Acquired } from './page-agent.js';
import { scanSource } from './source.js';
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
import { routeOf, widthsOf } from './widths.js';

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
 * Not a crawler and not a sitemap reader. The routes are a map the operator
 * writes, because a discovered URL is a subject nobody chose: a crawl that finds
 * one more page on Tuesday reports a `new` subject that no one can approve and
 * no one asked for. Percy's no-code URL list is the nearest comparable thing and
 * it is genuinely less work; the difference is who decides what is under test.
 */


const DEFAULT_ROOTS = ['body'];
const DEFAULT_READY_TIMEOUT_MS = 10_000;

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

    // Pointed at the first route so the browser opens on something real, and
    // re-injected per navigation below. A route run navigates per subject by
    // definition — that is what a route is — so the one-navigation saving a
    // Storybook gets is not available here and is not pretended to be.
    // Installed through `prepare`, before the harness's own first navigation.
    // Attaching afterwards would miss every asset that first document pulled in,
    // and the only repair for that is a second page load — one per run, to
    // observe the one already paid for.
    let network: NetworkObservation | undefined;

    const harness: Harness = await createHarness({
      // Somewhere to be while the agent is installed. With a discovered plan
      // there is no first route yet — the sitemap has not been fetched — so the
      // harness opens `about:blank` and the first `collect` navigates.
      url: entries[0]?.[1] ?? 'about:blank',
      bundle,
      viewport: config.viewport,
      ...(config.fonts !== undefined ? { fonts: config.fonts } : {}),
      ...(options.headless !== undefined ? { headless: options.headless } : {}),
      ...(options.network === false
        ? {}
        : {
            prepare: async (page): Promise<void> => {
              network = await observeNetwork(
                page,
                config.blank !== undefined ? { blank: config.blank } : {},
              );
            },
          }),
    });

    const page = harness.page;
    const engine = harness.engine;
    // Filled by `plan()` when the routes are discovered rather than declared.
    let resolved: Readonly<Record<string, string>> | undefined;
    // Held for the run's lifetime when a directory is being served, and closed
    // with the collector: a file server outliving the run holds the port.
    let served: StaticServer | undefined;
    // Tracks *navigations*, not URLs. A run that reads one route at two widths
    // navigates to the same address twice, and a check on the address alone
    // would decide the agent was still installed after a load that discarded it
    // — which surfaces as an evaluate error naming a missing global rather than
    // as anything a reader could act on.
    let agentInstalled = false;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) agentInstalled = false;
    });

    async function ensureAgent(): Promise<void> {
      if (agentInstalled) return;

      // A navigation discards injected scripts, so the agent is reinstalled and
      // its presence checked rather than assumed. An absent agent surfaces as a
      // named failure here instead of as an inscrutable evaluate error.
      await page.addScriptTag({ content: bundle });
      const installed = await page.evaluate(
        (global: string) => typeof (globalThis as unknown as Record<string, unknown>)[global] === 'object',
        AGENT_GLOBAL,
      );
      if (!installed) throw new Error(`the page bundle did not install ${AGENT_GLOBAL}`);
      agentInstalled = true;
    }

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
              throw new Error(
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
                  'A page this stops listing stops being watched, and nothing here will say so ' +
                  '— declare the routes explicitly if that matters',
              ],
            },
            options.widths,
            config.viewport,
          );
        }

        if (plan === undefined) {
          throw new Error(
            'this collector expects `subjects.kind: "list"`, which is what supplies the plan — ' +
              'or `sitemap`, with `subjects.kind: "collector"`, to discover one',
          );
        }
        return widthsOf(plan, options.widths, config.viewport);
      },

      async collect(planned: PlannedSubject): Promise<Collected> {
        const id = planned.subject.id;
        // `route/home@375` is one width of `route/home`, and the URL belongs to
        // the route. Resolved here rather than by rewriting the plan's ids,
        // because the id is what a baseline, a report line and a `--subjects`
        // glob all name — and those have to stay distinct per width.
        const url = (resolved ?? options.routes ?? {})[routeOf(id, options.widths)];

        // Reported, never dropped. An id in the plan with no route here is a hole
        // in this run's coverage, and a run that observes 29 of 30 subjects and
        // says nothing about the 30th is the silence this project refuses.
        if (url === undefined) {
          return { ok: false, because: `no route is configured for \`${id}\`` };
        }

        const wanted = planned.viewport ?? config.viewport;

        // A context's scale factor and colour scheme are fixed when it is
        // created, so a subject asking for different ones cannot be honoured by
        // resizing — and painting it at the run's values while *recording* its
        // own would put a lie in the environment key, which is the one field
        // everything else trusts. Refused by name instead.
        const fixed = unresizable(wanted, config.viewport);
        if (fixed !== undefined) return { ok: false, because: fixed };

        try {
          const current = page.viewportSize();
          const resized = current?.width !== wanted.width || current?.height !== wanted.height;

          if (resized) await page.setViewportSize({ width: wanted.width, height: wanted.height });

          // Re-navigated when the size changed, not merely reflowed. CSS reflows
          // on a resize; a component that read `matchMedia` when it mounted does
          // not, and neither does an image chosen by `sizes` at first layout. A
          // page reached by resizing a wider one is therefore not the page a
          // visitor at that width gets, and the difference is invisible in the
          // result — which is the direction this project never accepts.
          if (page.url() !== url || resized) {
            // Cleared before the navigation, not after: a route run visits one
            // page per subject, so what this page fetches *is* this subject's
            // asset set. Reusing one page across subjects would make it the
            // union, which over-invalidates rather than under-invalidates.
            network?.reset();
            // `goto` navigates even when the address is unchanged, which is what
            // makes a width change a *load* rather than a reflow.
            await page.goto(url, { waitUntil: 'load' });
          }

          const ready = options.ready?.[id];
          if (ready !== undefined) {
            await page.waitForSelector(ready, {
              timeout: options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
            });
          }
        } catch (error) {
          return {
            ok: false,
            because:
              `the route did not become ready at ${url}` +
              (options.ready?.[id] === undefined
                ? ''
                : ` (waiting for ${options.ready[id]})`) +
              `: ${error instanceof Error ? error.message : String(error)}`,
          };
        }

        // After readiness, before reading. `load` fires when the document is
        // parsed, and an image requested by a script that ran on `load` is still
        // in flight — which the page cannot see (it is not in `document.images`
        // yet) and the wire can.
        await network?.settle();

        await ensureAgent();

        const declaredLoading = (options.loading ?? []).some((pattern) =>
          matchesGlob(planned.subject.id, pattern),
        );

        const worn = new Set(planned.tags ?? []);
        const selectable = (config.ignore ?? []).flatMap((rule) =>
          rule.select === undefined ||
          (rule.subjects !== undefined &&
            !rule.subjects.some((pattern) => matchesGlob(planned.subject.id, pattern))) ||
          (rule.tags !== undefined && !rule.tags.some((tag) => worn.has(tag)))
            ? []
            : [{ id: rule.id, select: rule.select }],
        );

        const request: AcquireRequest = {
          subjectId: id,
          viewport: planned.viewport ?? config.viewport,
          engine,
          ...(config.fonts !== undefined ? { fonts: config.fonts } : {}),
          // Sent into the page so the capture records them, because the
          // environment key is assembled where the capture is. The driver is the
          // only party that saw the bytes; the page is the only party that
          // builds the key. Neither can do it alone.
          ...(network !== undefined && Object.keys(network.assets).length > 0
            ? { assets: { ...network.assets } }
            : {}),
          // Only the rules that name a selector cross into the page. A
          // fingerprint rule has nothing for a document to resolve, and sending
          // one would put a digest in a browser that cannot use it.
          ...(selectable.length > 0 ? { ignore: selectable } : {}),
          ...(options.stabilize !== undefined ? { stabilize: options.stabilize } : {}),
          // A subject declared as a loading capture waits for nothing: the whole
          // point of it is the fallback, and paying the timeout to be told the
          // boundary is still there would cost five seconds per route to learn
          // what the declaration already said.
          ...(declaredLoading
            ? { suspense: { timeoutMs: 0 } }
            : options.suspenseTimeoutMs !== undefined
              ? { suspense: { timeoutMs: options.suspenseTimeoutMs } }
              : {}),
          roots,
        };

        const raw = await page.evaluate(
          ([global, sent]: readonly [string, AcquireRequest]) => {
            const agent = (globalThis as unknown as Record<string, { acquire(r: AcquireRequest): Promise<string> }>)[
              global
            ];
            if (agent === undefined) throw new Error(`missing page agent ${global}`);
            return agent.acquire(sent);
          },
          [AGENT_GLOBAL, request] as const,
        );

        const acquired = JSON.parse(raw) as Acquired;

        // The symptom of a page agent older than this driver, named rather than
        // read past: `undefined` here would make `suspenseRefusal` throw inside
        // one route and take the run with it, and defaulting it to "settled"
        // would silently restore the behaviour this exists to end.
        if (acquired.suspense === undefined) {
          return {
            ok: false,
            because:
              'the page agent returned no Suspense reading, which means the bundle in ' +
              '`@variance-authority/route-collector` predates it — rebuild the package',
          };
        }

        // The forced decision. A route still showing a fallback is refused with
        // the boundary named, unless somebody declared that this is the subject.
        const unsettled = suspenseRefusal(acquired.suspense, {
          subjectId: planned.subject.id,
          declaredLoading,
        });
        if (unsettled !== undefined) return { ok: false, because: unsettled };

        return {
          ok: true,
          document: acquired.document,
          // Normalized here rather than in the page: the ruleset is the one the
          // jsdom path uses, and running it in the browser would make the two
          // profiles two implementations of it.
          // `sourceRoot` for the same reason `scanSource` is rooted at the cwd
          // above: both answers name files, and a report that mixes a
          // repository-relative declaration with an absolute call site is one
          // nobody can paste into anything.
          snapshot: normalizeCapture(acquired.capture, { sourceRoot: process.cwd() }),
          ...(acquired.stabilization !== undefined && acquired.stabilization.length > 0
            ? { stabilization: acquired.stabilization }
            : {}),
          ...(source !== undefined ? { source } : {}),
        };
      },

      async close(): Promise<void> {
        await network?.close();
        await harness.close();
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
