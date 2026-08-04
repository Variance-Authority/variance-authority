import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalize as normalizeCapture } from '@variance-authority/core';
import type {
  RenderDocument,
  SemanticSnapshot,
  SourceIndex,
  SubjectRef,
  Viewport,
} from '@variance-authority/core';
import { createHarness, type Harness } from '@variance-authority/playwright';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import type { AcquireRequest, Acquired } from './page-agent.js';
import { scanSource, type SourceScan } from './source.js';

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

export interface CollectorConfig {
  readonly viewport: Viewport;
  readonly fonts?: readonly string[];
}

export interface PlannedSubject {
  readonly subject: SubjectRef;
  readonly viewport?: Viewport;
}

export interface Plan {
  readonly subjects: readonly PlannedSubject[];
  readonly notObserved: readonly unknown[];
  readonly warnings: readonly string[];
}

export type Collected =
  | {
      readonly ok: true;
      readonly document: RenderDocument;
      readonly snapshot?: SemanticSnapshot;
      readonly source?: SourceIndex;
    }
  | { readonly ok: false; readonly because: string };

export interface CollectorContext {
  readonly config: CollectorConfig;
  /** Computed by the run from `subjects.ids`. Returned unchanged. */
  readonly plan?: Plan;
}

export interface Collector {
  plan(): Promise<Plan>;
  collect(subject: PlannedSubject): Promise<Collected>;
  close(): Promise<void>;
}

export interface RouteCollectorOptions {
  /**
   * Subject id to the URL that serves it.
   *
   * The ids must be the ones in `subjects.ids`, because the run plans from the
   * config and collects from here — a route with no id is never visited, and an
   * id with no route is reported as a subject that could not be collected rather
   * than silently dropped.
   */
  readonly routes: Readonly<Record<string, string>>;

  /**
   * The subject's root, tightest first. Defaults to `body`.
   *
   * Bounding it is what keeps a shared header out of every page's comparison,
   * and what makes pruning affordable — the 1007-rules-to-1 ratio is a property
   * of a bounded subject. `body` is the caller saying the page is the subject.
   */
  readonly roots?: readonly string[];

  /**
   * Subject id to a selector that says the page is ready.
   *
   * Per route, not per project. `load` fires when the document is parsed, which
   * for anything that fetches after mount is *before the page exists* — and a
   * project-wide default would be a guess about every route to solve a problem
   * some of them have. A route that declares a marker and never attaches it
   * times out saying which selector it waited for; falling back is how you
   * photograph a spinner.
   */
  readonly ready?: Readonly<Record<string, string>>;

  /** Where the components live, for `file:line` attribution. */
  readonly source?: SourceScan;

  /** Milliseconds to wait for a declared ready selector. Defaults to 10000. */
  readonly readyTimeoutMs?: number;

  /** Defaults to `true`. Set false to watch a run by hand. */
  readonly headless?: boolean;
}

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
    const entries = Object.entries(options.routes);

    if (entries.length === 0) {
      throw new Error('routeCollector needs at least one route; a run over no subjects is not a run');
    }

    const source = options.source === undefined ? undefined : scanSource(process.cwd(), options.source);
    const bundle = await pageAgentBundle();

    // Pointed at the first route so the browser opens on something real, and
    // re-injected per navigation below. A route run navigates per subject by
    // definition — that is what a route is — so the one-navigation saving a
    // Storybook gets is not available here and is not pretended to be.
    const harness: Harness = await createHarness({
      url: entries[0]![1],
      bundle,
      viewport: config.viewport,
      ...(config.fonts !== undefined ? { fonts: config.fonts } : {}),
      ...(options.headless !== undefined ? { headless: options.headless } : {}),
    });

    const page = harness.page;
    const engine = harness.engine;
    let injectedInto = page.url();

    async function ensureAgent(): Promise<void> {
      const url = page.url();
      if (url === injectedInto) return;

      // A navigation discards injected scripts, so the agent is reinstalled and
      // its presence checked rather than assumed. An absent agent surfaces as a
      // named failure here instead of as an inscrutable evaluate error.
      await page.addScriptTag({ content: bundle });
      const installed = await page.evaluate(
        (global: string) => typeof (globalThis as unknown as Record<string, unknown>)[global] === 'object',
        AGENT_GLOBAL,
      );
      if (!installed) throw new Error(`the page bundle did not install ${AGENT_GLOBAL}`);
      injectedInto = url;
    }

    return {
      async plan(): Promise<Plan> {
        if (plan === undefined) {
          throw new Error(
            'this collector expects `subjects.kind: "list"`, which is what supplies the plan',
          );
        }
        return plan;
      },

      async collect(planned: PlannedSubject): Promise<Collected> {
        const id = planned.subject.id;
        const url = options.routes[id];

        // Reported, never dropped. An id in the plan with no route here is a hole
        // in this run's coverage, and a run that observes 29 of 30 subjects and
        // says nothing about the 30th is the silence this project refuses.
        if (url === undefined) {
          return { ok: false, because: `no route is configured for \`${id}\`` };
        }

        try {
          if (page.url() !== url) await page.goto(url, { waitUntil: 'load' });

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

        await ensureAgent();

        const request: AcquireRequest = {
          subjectId: id,
          viewport: planned.viewport ?? config.viewport,
          engine,
          ...(config.fonts !== undefined ? { fonts: config.fonts } : {}),
          roots,
        };

        const raw = await page.evaluate(
          ([global, sent]: readonly [string, AcquireRequest]) => {
            const agent = (globalThis as unknown as Record<string, { acquire(r: AcquireRequest): string }>)[
              global
            ];
            if (agent === undefined) throw new Error(`missing page agent ${global}`);
            return agent.acquire(sent);
          },
          [AGENT_GLOBAL, request] as const,
        );

        const acquired = JSON.parse(raw) as Acquired;

        return {
          ok: true,
          document: acquired.document,
          // Normalized here rather than in the page: the ruleset is the one the
          // jsdom path uses, and running it in the browser would make the two
          // profiles two implementations of it.
          snapshot: normalizeCapture(acquired.capture),
          ...(source !== undefined ? { source } : {}),
        };
      },

      async close(): Promise<void> {
        await harness.close();
      },
    };
  };
}

export type { SourceScan } from './source.js';
export type { AcquireRequest, Acquired } from './page-agent.js';
