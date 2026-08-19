import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createCallSiteResolver,
  matchesGlob,
  normalize as normalizeCapture,
} from '@variance-authority/core';
import {
  createHarness,
  fetchModules,
  observeNetwork,
  unresizable,
  type Harness,
  type NetworkObservation,
} from '@variance-authority/playwright';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { suspenseRefusal } from '@variance-authority/react';
import { collectStory, harnessPage } from '@variance-authority/storybook';
import type { AcquireRequest, Acquired } from './page-agent.js';
export type {
  Collected,
  Collector,
  CollectorConfig,
  CollectorContext,
  Plan,
  PlannedSubject,
} from './contract.js';
import type { Collected, Collector, CollectorContext, Plan, PlannedSubject } from './contract.js';
import { serveStatic, type StaticServer } from './serve.js';
import { scanSource, type SourceScan } from './source.js';

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


export interface StorybookCollectorOptions {
  /**
   * Story id to the selector that says it is ready.
   *
   * Per story, not per project, and that is the design rather than an
   * ergonomics gap. A button needs no marker and demanding one from it would
   * time out every story to solve a problem one of them has. A story that
   * declares a marker and never attaches it times out saying which selector it
   * waited for — there is no fallback, because falling back is how you
   * photograph a spinner and call it a component.
   */
  readonly ready?: Readonly<Record<string, string>>;

  /**
   * Where the components live, for `file:line` attribution.
   *
   * Omitted, the report names components and no files — which is still ahead of
   * every product in the category and is not what this is for.
   */
  readonly source?: SourceScan;

  /**
   * A Storybook that is already served, e.g. `http://localhost:6006`.
   *
   * Preferred when it exists: then nothing here has an opinion about how the
   * build is hosted. Omitted, the directory holding `subjects.index` is served
   * on a loopback port for the life of the run.
   */
  readonly baseUrl?: string;

  /** Defaults to `true`. Set false to watch a run by hand. */
  readonly headless?: boolean;

  /**
   * Watch the wire: hash asset bodies into the environment key, and serve
   * animated GIFs as their first frame. Defaults to `true`.
   *
   * On, this is what closes a false `unchanged` that a page cannot see about
   * itself. A logo re-exported at the same URL is the same markup, the same CSS
   * and the same document — so every tier settles, and the run reports that
   * nothing moved while the image on the page is different bytes. Only the party
   * that saw the response knows otherwise.
   *
   * The assets are narrowed **per story** before they reach a key, from the URLs
   * that story's own subtree references (`assetsFor`). Without that, a run that
   * reads three hundred stories out of one page would give story 200 a key that
   * depends on which stories ran before it, and sharding the suite would change
   * every baseline's identity.
   *
   * Off is a position for a build whose asset URLs already contain their own
   * content hash: the URL is then the identity, and hashing the bytes again buys
   * a read and nothing else.
   */
  readonly network?: boolean;

  /** Overrides the roots the story is read from. Tightest first. */
  readonly roots?: readonly string[];

  /** Milliseconds for Storybook or a declared marker to report readiness. Defaults to 15000. */
  readonly readyTimeoutMs?: number;

  /**
   * Milliseconds to wait for a story's Suspense boundaries. Defaults to 5000.
   *
   * Paid only by stories that are actually waiting: a subtree with no boundary
   * in it returns on the first read. `0` turns the wait off and keeps the
   * reading, which is a position for a project whose readiness markers already
   * cover its data — the refusal below still fires, so the boundary is reported
   * rather than photographed.
   */
  readonly suspenseTimeoutMs?: number;

  /**
   * Stories whose *loading* state is the subject, as id globs.
   *
   * The escape hatch, and the only one. A story left showing its fallback is
   * otherwise refused, because a subject that records a skeleton on a slow
   * machine and a component on a fast one is a flake nobody wrote — so a
   * skeleton somebody *does* want a baseline over has to be said out loud.
   *
   * Declared here rather than sensed, and checked in both directions: a story
   * named by this that turns out to settle is refused too. A declaration that
   * outlived its subject is the same nondeterminism arriving from the other side.
   *
   * Matched against the story id and the subject id both, so
   * `case-surface--feed` and `story:case-surface--feed` name the same story —
   * `ready` above is keyed by the first.
   */
  readonly loading?: readonly string[];
}

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

    // The build the config named, not a sibling this file assumed. Serving the
    // directory that holds the planned index is the only arrangement in which the
    // stories driven and the stories planned are guaranteed to be the same ones.
    const staticDir = dirname(config.subjects.index);

    if (options.baseUrl === undefined && !existsSync(join(staticDir, 'index.json'))) {
      throw new Error(
        `${staticDir} has no index.json; build the Storybook first, or point ` +
          '`baseUrl` at one that is already served',
      );
    }

    const source = options.source === undefined ? undefined : scanSource(process.cwd(), options.source);
    const bundle = await pageAgentBundle();

    let served: StaticServer | undefined;
    if (options.baseUrl === undefined) served = await serveStatic(staticDir);
    const baseUrl = options.baseUrl ?? served!.baseUrl;

    let harness: Harness | undefined;
    // Installed in `prepare`, which runs before the first navigation: an
    // observation that starts afterwards has already missed the assets the
    // preview loaded on its way up, and a URL nobody saw is a hole in the key.
    let network: NetworkObservation | undefined;
    try {
      // Pointed at the preview, so `collectStory` finds itself already there and
      // does not navigate: one navigation for a whole run is the saving ADR-0009
      // rests on, and it is easiest to keep by never taking a second one.
      harness = await createHarness({
        url: `${baseUrl}/iframe.html`,
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
    } catch (error) {
      await served?.close();
      throw error;
    }

    const page = harness.page;
    const engine = harness.engine;

    // One per run, not one per story. Every story in a Storybook is written in
    // the same handful of modules, so the second story onward resolves its call
    // sites out of this cache without a single fetch.
    const callSites = createCallSiteResolver(fetchModules(page));

    return {
      async plan(): Promise<Plan> {
        if (plan === undefined) {
          throw new Error(
            'this collector expects `subjects.kind: "storybook"`, which is what supplies the plan',
          );
        }
        return plan;
      },

      async collect(planned: PlannedSubject): Promise<Collected> {
        const storyId = planned.subject.id.replace(/^story:/, '');
        const viewport = planned.viewport ?? config.viewport;
        const readySelector = options.ready?.[storyId];

        // Applied, not merely recorded. A story that declares its own viewport
        // was being painted at the run's width while its environment key said
        // otherwise — a baseline whose key describes a render that never
        // happened, and a verdict over it that is green for the wrong reason.
        // The resize precedes the mount, so a component that reads `matchMedia`
        // when it mounts reads the width it is about to be shown at.
        const fixed = unresizable(viewport, config.viewport);
        if (fixed !== undefined) return { ok: false, because: fixed };

        const current = page.viewportSize();
        if (current?.width !== viewport.width || current?.height !== viewport.height) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
        }

        const outcome = await collectStory(harnessPage({ page }), storyId, {
          baseUrl,
          ...(options.readyTimeoutMs !== undefined ? { timeoutMs: options.readyTimeoutMs } : {}),
          ...(readySelector !== undefined ? { readySelector } : {}),
        });

        // A story that did not render is a hole in this run's coverage, and it
        // travels as a value rather than an exception: one component that throws
        // must not cost the others their observations, and must not be silently
        // absent either.
        if (outcome.status !== 'rendered') {
          return {
            ok: false,
            because:
              `the story did not render (${outcome.status}, readiness ${outcome.readiness})` +
              (outcome.error === undefined ? '' : `: ${outcome.error.message}`),
          };
        }

        // After the story has mounted and before it is read. A story whose
        // image is still in flight is a story whose bytes nobody hashed, and the
        // wait is the driver's because the page cannot see its own requests.
        // Never a failure: a page that keeps fetching is reported, not refused.
        await network?.settle();

        // Either form matches. A subject is `story:case-surface--x` and a story
        // is `case-surface--x`, and `ready` above is keyed by the second — so a
        // declaration written the way the neighbouring option is written has to
        // work, or the escape hatch fails silently and the story it was written
        // for is refused anyway.
        const declaredLoading = (options.loading ?? []).some(
          (pattern) => matchesGlob(planned.subject.id, pattern) || matchesGlob(storyId, pattern),
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
          subjectId: planned.subject.id,
          viewport,
          engine,
          ...(config.fonts !== undefined ? { fonts: config.fonts } : {}),
          // The page's whole observed set, narrowed inside the page to the URLs
          // this story references. Sent whole because the driver cannot know
          // which of them the story uses, and narrowed there because the page
          // cannot know what the bytes were. Never reset between stories: one
          // page serves the whole run, and a story whose asset was fetched
          // during an earlier story still references it.
          ...(network !== undefined && Object.keys(network.assets).length > 0
            ? { assets: { ...network.assets } }
            : {}),
          // Only the rules that name a selector cross into the page. A
          // fingerprint rule has nothing for a document to resolve, and sending
          // one would put a digest in a browser that cannot use it.
          ...(selectable.length > 0 ? { ignore: selectable } : {}),
          // A story declared as a loading capture waits for nothing: the whole
          // point of it is the fallback, and paying the timeout to be told the
          // boundary is still there would cost five seconds per story to learn
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
        // one story and take the run with it, and defaulting it to "settled"
        // would silently restore the behaviour this exists to end.
        if (acquired.suspense === undefined) {
          return {
            ok: false,
            because:
              'the page agent returned no Suspense reading, which means the bundle in ' +
              '`@variance-authority/storybook-collector` predates it — rebuild the package',
          };
        }

        // The forced decision. A story still showing a fallback is refused with
        // the boundary named, unless somebody declared that this is the subject.
        const unsettled = suspenseRefusal(acquired.suspense, {
          subjectId: planned.subject.id,
          declaredLoading,
        });
        if (unsettled !== undefined) return { ok: false, because: unsettled };

        // No frames are spent here, and that is deliberate: a story that settles
        // on its document digest has nobody to hand a location to. They ride the
        // snapshot as provenance — which no hash projects — and `locateSites`
        // spends them for the few nodes a region or a finding names.
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
          // No `causes`. Naming the roots of a change needs the *previous*
          // snapshot, and a durable run has a baseline image without one — so
          // ranking falls back to area, which `rankRegions` documents as honest
          // and not good.
        };
      },

      callSites,

      async close(): Promise<void> {
        await network?.close();
        await harness?.close();
        await served?.close();
      },
    };
  };
}

export type { SourceScan } from './source.js';
export type { AcquireRequest, Acquired } from './page-agent.js';
