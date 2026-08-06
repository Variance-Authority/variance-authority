import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { matchesGlob, normalize as normalizeCapture } from '@variance-authority/core';
import type {
  RenderDocument,
  SemanticSnapshot,
  SourceIndex,
  SubjectRef,
  Viewport,
} from '@variance-authority/core';
import {
  createHarness,
  observeNetwork,
  type Harness,
  type NetworkObservation,
} from '@variance-authority/playwright';
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
  /**
   * Subtrees this project excludes, from `config.ignore` (spec 0024).
   *
   * Only the two fields a page needs: a rule id to record the mark under, and a
   * selector to find it with. Everything else about a rule — its reason, its
   * expiry, the bands it narrows to — is decided after collection, where a clock
   * and the whole run's diffs are available and a browser is not.
   */
  readonly ignore?: readonly {
    readonly id: string;
    readonly select?: string;
    /**
     * Subjects the rule names. Read here to decide what to send, and never sent.
     *
     * A page can resolve a selector and cannot know which subject it is one of,
     * so scoping has to happen on this side of the boundary. Without it a rule
     * written for one route marks its element in every subject that renders the
     * same shared layout, and a real regression inside that element is absorbed
     * everywhere — an ignore silencing more than it says, which is the one thing
     * the mechanism must not do.
     */
    readonly subjects?: readonly string[];

    /** Tags the subject must carry. Read here to decide what to send, never sent. */
    readonly tags?: readonly string[];
  }[];

}

export interface PlannedSubject {
  readonly subject: SubjectRef;
  readonly viewport?: Viewport;

  /**
   * What the subject declares itself to be.
   *
   * Present for a Storybook plan, where the built index carries a story's tags.
   * A route plan has no artifact to read one from, so it is absent — and absent
   * means *undeclared*, never *no tags*: a rule scoped by tag simply does not
   * apply here, rather than applying to everything.
   */
  readonly tags?: readonly string[];
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

  /**
   * Watch what the page is served. Defaults to `true`.
   *
   * On, this is where `EnvironmentInputs.assets` comes from — a field that has
   * existed since the format did and was filled by nobody, leaving an image
   * swapped under the same URL as a false `unchanged`. It is also where animated
   * GIFs are frozen, which no CSS can reach.
   *
   * Off is a position for a page whose assets are content-addressed URLs
   * already, or a run that cannot afford routing's loss of the browser's HTTP
   * cache. The cost is stated in `@variance-authority/playwright`'s
   * `network.ts`; the assets map is then empty and says so by being empty.
   */
  readonly network?: boolean;

  /**
   * Stabilization tricks to hold each page still with, by id. Defaults to
   * `COLLECT_RECIPE`, which is almost certainly what you want.
   *
   * The knob exists for two callers. One is a page whose own determinism story
   * is better than ours — a suite that already freezes its own clock and its own
   * animations, where a second `!important` sheet is damage buying nothing. The
   * other is this repository's own test for what happens *without* it, which
   * needs to be able to ask for nothing and get nothing.
   *
   * `[]` means observed untouched, and is recorded as such: the environment key
   * carries no stabilization digest, so an untouched baseline and a held-still
   * one are two baselines rather than a diff nobody can explain.
   */
  readonly stabilize?: readonly string[];
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
    // Installed through `prepare`, before the harness's own first navigation.
    // Attaching afterwards would miss every asset that first document pulled in,
    // and the only repair for that is a second page load — one per run, to
    // observe the one already paid for.
    let network: NetworkObservation | undefined;

    const harness: Harness = await createHarness({
      url: entries[0]![1],
      bundle,
      viewport: config.viewport,
      ...(config.fonts !== undefined ? { fonts: config.fonts } : {}),
      ...(options.headless !== undefined ? { headless: options.headless } : {}),
      ...(options.network === false
        ? {}
        : {
            prepare: async (page): Promise<void> => {
              network = await observeNetwork(page);
            },
          }),
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
          if (page.url() !== url) {
            // Cleared before the navigation, not after: a route run visits one
            // page per subject, so what this page fetches *is* this subject's
            // asset set. Reusing one page across subjects would make it the
            // union, which over-invalidates rather than under-invalidates.
            network?.reset();
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
        await network?.close();
        await harness.close();
      },
    };
  };
}

export type { SourceScan } from './source.js';
export type { AcquireRequest, Acquired } from './page-agent.js';
