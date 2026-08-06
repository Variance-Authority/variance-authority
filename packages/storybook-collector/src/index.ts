import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
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
import { createHarness, type Harness } from '@variance-authority/playwright';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { collectStory, harnessPage } from '@variance-authority/storybook';
import type { AcquireRequest, Acquired } from './page-agent.js';
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

/** The subset of a run's configuration this collector reads. */
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

  readonly subjects: { readonly index: string };
}

export interface PlannedSubject {
  readonly subject: SubjectRef;
  readonly viewport?: Viewport;

  /**
   * What the subject declares itself to be, from the artifact that produced it.
   *
   * Storybook's built index carries `tags` and does not carry a story's
   * `parameters`, so a tag is the only per-story declaration that survives a
   * build — and it is the right one anyway: what a subject *is* belongs in its
   * own name, next to it, rather than in a central file repeating every id.
   *
   * Selection lives here; definition lives in the config. A tag is a word a
   * story wears, and what that word *means* is the operator's to write down
   * once, where a typo can be refused by name.
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
  /** Computed by the run from the story index. Returned unchanged. */
  readonly plan?: Plan;
}

export interface Collector {
  plan(): Promise<Plan>;
  collect(subject: PlannedSubject): Promise<Collected>;
  close(): Promise<void>;
}

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

  /** Overrides the roots the story is read from. Tightest first. */
  readonly roots?: readonly string[];
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
      });
    } catch (error) {
      await served?.close();
      throw error;
    }

    const page = harness.page;
    const engine = harness.engine;

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

        const outcome = await collectStory(harnessPage({ page }), storyId, {
          baseUrl,
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
          // Only the rules that name a selector cross into the page. A
          // fingerprint rule has nothing for a document to resolve, and sending
          // one would put a digest in a browser that cannot use it.
          ...(selectable.length > 0 ? { ignore: selectable } : {}),
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
          // No `causes`. Naming the roots of a change needs the *previous*
          // snapshot, and a durable run has a baseline image without one — so
          // ranking falls back to area, which `rankRegions` documents as honest
          // and not good.
        };
      },

      async close(): Promise<void> {
        await harness?.close();
        await served?.close();
      },
    };
  };
}

export type { SourceScan } from './source.js';
export type { AcquireRequest, Acquired } from './page-agent.js';
