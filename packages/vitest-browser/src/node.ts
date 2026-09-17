import { hashComponents } from '@variance-authority/core/attribute';
import { documentDigest } from '@variance-authority/core/format';
import type { CaptureArtifact } from '@variance-authority/core';
import {
  observeCaptureAgainstBaseline,
  summarizeObservation,
} from '@variance-authority/observe';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import type { BaselineKey, RasterStore, Renderer } from '@variance-authority/raster';
import { createDurableStore } from '@variance-authority/store/durable';
import { OBSERVE_COMMAND, type Observed, type ObserveRequest } from './protocol.js';

/**
 * The half that runs in the Vitest process.
 *
 * It owns the two things the tab cannot have: the baseline, and a browser to
 * paint a document with. Both are opened once per run rather than per
 * observation — a renderer is a browser, and a suite of three hundred subjects
 * that launched one each would spend the run in startup.
 *
 * The renderer paints the acquired document; the tab's own screenshot is not
 * used, and the browser being right there is exactly why that is worth saying.
 * A live screenshot has no `identityFor` behind it — nothing painted it that
 * can say which machine, which scale, which font stack — so its baseline is
 * reproducible on no other machine, including the CI runner that will judge it
 * next.
 */

export interface VarianceNodeOptions {
  /** Defaults to `.variance/baselines`. */
  readonly baselines?: string;
  /** Supply an existing renderer when the suite already owns its lifetime. */
  readonly renderer?: Renderer;
  /** Supply an existing store when baselines do not live in a directory. */
  readonly store?: RasterStore;

  /**
   * Whether this run may promote a candidate to a baseline.
   *
   * Absent reads Vitest's own `--update`, which is the flag a person already
   * types for the snapshots in the same suite. Set it to `false` to hold
   * baselines out of that, and to `true` for a job whose whole purpose is to
   * write them.
   */
  readonly accept?: boolean;
}

/**
 * The command the browser half calls, plus the lifetime it holds open.
 *
 * Separate from {@link variancePlugin} because a project that already builds
 * its Vitest config in code has somewhere to put both of these, and should not
 * have to accept a plugin's opinion about when the browser closes.
 */
export interface VarianceCommands {
  readonly varianceObserve: (context: unknown, request: ObserveRequest) => Promise<Observed>;
  readonly close: () => Promise<void>;
}

export function varianceCommands(options: VarianceNodeOptions = {}): VarianceCommands {
  const store = options.store ?? createDurableStore(options.baselines ?? '.variance/baselines');
  let renderer: Promise<Renderer> | undefined = undefined;

  // Opened on the first observation rather than here. A watch-mode session that
  // edits a test file and never reaches a `variance()` call should not be
  // holding a browser open for the afternoon.
  const painting = (): Promise<Renderer> => {
    renderer ??= options.renderer === undefined
      ? createPlaywrightRenderer()
      : Promise.resolve(options.renderer);
    return renderer;
  };

  return {
    varianceObserve: async (context, request) => {
      const artifact = request.artifact;
      const key: BaselineKey = { subject: artifact.subject.id };
      const painter = await painting();
      const observation = await observeCaptureAgainstBaseline(artifact, key, {
        store,
        renderer: painter,
        ...(request.sensitivity === undefined ? {} : { sensitivity: request.sensitivity }),
      });

      // TODO: the browser-native accessibility tree is not read. The command
      // context carries the provider's own page, so a subject located by
      // selector could be asked for an aria snapshot here and compared as the
      // band it is; until then an observation from this surface carries the
      // other bands and says nothing about that one.

      const accepting = options.accept ?? updating(context);
      if (accepting && observation.verdict !== 'unchanged') {
        await promote(store, painter, artifact, key);
      }

      return {
        ...observation,
        message: summarizeObservation(
          observation,
          artifact.source === undefined ? {} : { source: artifact.source },
        ),
      };
    },
    close: async () => {
      if (renderer === undefined) return;
      const opened = await renderer;
      renderer = undefined;
      // A renderer the caller supplied is a lifetime the caller owns.
      if (options.renderer === undefined) await opened.close();
    },
  };
}

/**
 * What a Vitest config registers: the command, and closing the browser after.
 *
 * Typed structurally rather than as Vite's `Plugin`, so this package does not
 * declare a dependency on a bundler to describe an object with three members.
 */
export interface VarianceVitePlugin {
  readonly name: string;
  readonly config: () => {
    readonly test: {
      readonly browser: {
        readonly commands: Readonly<Record<string, unknown>>;
      };
    };
  };
  readonly closeBundle: () => Promise<void>;
}

/**
 * ```ts
 * // vitest.config.ts
 * export default defineConfig({
 *   plugins: [react(), variancePlugin()],
 *   test: { browser: { enabled: true, provider: 'playwright', instances: [{ browser: 'chromium' }] } },
 * });
 * ```
 */
export function variancePlugin(options: VarianceNodeOptions = {}): VarianceVitePlugin {
  const commands = varianceCommands(options);
  return {
    name: 'variance-authority',
    config: () => ({
      test: { browser: { commands: { [OBSERVE_COMMAND]: commands.varianceObserve } } },
    }),
    closeBundle: async () => {
      await commands.close();
    },
  };
}

/**
 * Whether the run was started with `--update`.
 *
 * Read off the command context rather than from `process.argv`, because a
 * project running several Vitest projects in one process is entitled to answer
 * differently for each. Absent everywhere means no: promoting a candidate is
 * the one thing here that must never happen because a field could not be found.
 */
function updating(context: unknown): boolean {
  const project = (context as { readonly project?: { readonly vitest?: unknown } } | undefined)
    ?.project;
  const config = (project as { readonly vitest?: { readonly config?: unknown } } | undefined)
    ?.vitest;
  const snapshots = (
    config as
      | { readonly config?: { readonly snapshotOptions?: { readonly updateSnapshot?: string } } }
      | undefined
  )?.config?.snapshotOptions?.updateSnapshot;
  return snapshots === 'all';
}

/**
 * Promote the candidate this run already painted.
 *
 * The image comes from the render cache rather than from a second render, and
 * that is not only a saving: rendering again here would store an image nobody
 * compared, so the bytes a reviewer approved and the bytes that became the
 * baseline would be two different paints. A cache miss is refused rather than
 * papered over — the cache is allowed to be cold, and cold is exactly the case
 * where there is no candidate to promote.
 */
async function promote(
  store: RasterStore,
  renderer: Renderer,
  artifact: CaptureArtifact,
  key: BaselineKey,
): Promise<void> {
  if (artifact.material.kind !== 'document') {
    throw new Error(`cannot accept \`${key.subject}\`: its material is not a render document`);
  }
  const document = artifact.material.document;
  const identity = renderer.identityFor(document);
  const candidate = await store.renderCache.get(documentDigest(document), identity);
  if (candidate === null) {
    throw new Error(
      `cannot accept \`${key.subject}\`: this run produced no candidate for it. ` +
        'Acceptance promotes an image the run already painted and never paints one',
    );
  }

  // The image comes from the cache and the hashes do not. A render cache is
  // keyed by document digest and holds images; component hashes describe a
  // snapshot, which carries provenance a document does not. Promoting the
  // cached raster as-is would record a baseline with no hashes at all, and
  // every later run against it would rank regions by area.
  await store.put(key, {
    ...candidate,
    ...(artifact.snapshot === undefined ? {} : { components: hashComponents(artifact.snapshot) }),
  });
}
