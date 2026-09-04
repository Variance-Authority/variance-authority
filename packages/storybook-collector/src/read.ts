import { matchesGlob, normalize as normalizeCapture, type SourceIndex } from '@variance-authority/core';
import { acquireFromAgent, unresizable } from '@variance-authority/playwright';
import { suspenseRefusal } from '@variance-authority/react';
import { collectStory, harnessPage } from '@variance-authority/storybook';
import type { StoryRecorder } from './execution.js';
import type { Collected, CollectorConfig, PlannedSubject } from './contract.js';
import type { StorybookCollectorOptions } from './options.js';
import type { AcquireRequest, Acquired } from './page-agent.js';
import type { World } from './world.js';

/**
 * One story, read out of a world — which world being the only variable.
 *
 * Split out of `index.ts` so `collect` and `collectAlone` are the *same*
 * reading. Every input to a `Collected` other than the world is in
 * {@link Reading}, computed once per collector and handed to both: the
 * viewport, the ready selector, the ignore rules narrowed to this subject, the
 * loading declaration, the wiring and holdings flags, the suspense budget, the
 * roots, the source index, the base URL and therefore every asset URL. A second
 * copy of this body would let one of them drift, and a drifted input produces a
 * difference an operator reads as pollution when it is really a different recipe.
 */

export interface Reading {
  readonly config: CollectorConfig;
  readonly options: StorybookCollectorOptions;

  /**
   * Where the preview is served, shared by both worlds on purpose.
   *
   * A second static server would answer on a second port, which changes every
   * asset URL, which changes the environment key — so the clean collection would
   * come back `incomparable` and the run would learn nothing about order.
   */
  readonly baseUrl: string;
  readonly roots: readonly string[];
  readonly source?: SourceIndex;
}

export async function readStory(
  world: World,
  reading: Reading,
  planned: PlannedSubject,
  /**
   * Absent for an isolated reading, and deliberately.
   *
   * Nothing the recorder produces reaches `Collected` — it writes crossings into
   * the shared test-selection index, keyed by owner. A second window for the
   * same story out of a page that is about to be thrown away would count that
   * story's blocks twice, so a run that happened to ask about order would move
   * the selection index for the next run. The reading is identical; what is
   * skipped is a side effect on a file.
   */
  recorder?: StoryRecorder,
): Promise<Collected> {
  const { config, options, baseUrl, roots, source } = reading;
  const { page, engine, network } = world;
  const storyId = planned.subject.id.replace(/^story:/, '');

  const viewport = planned.viewport ?? config.viewport;
  const readySelector = options.ready?.[storyId];

  // Applied, not merely recorded. A story that declares its own viewport was
  // being painted at the run's width while its environment key said otherwise —
  // a baseline whose key describes a render that never happened, and a verdict
  // over it that is green for the wrong reason. The resize precedes the mount,
  // so a component that reads `matchMedia` when it mounts reads the width it is
  // about to be shown at.
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

  // A story that did not render is a hole in this run's coverage, and it travels
  // as a value rather than an exception: one component that throws must not cost
  // the others their observations, and must not be silently absent either.
  if (outcome.status !== 'rendered') {
    // A story that rendered a fallback still executed code, and counters left in
    // the page would be handed to whichever story drained next.
    await recorder?.note(page, planned.subject.id, false);
    return {
      ok: false,
      because:
        `the story did not render (${outcome.status}, readiness ${outcome.readiness})` +
        (outcome.error === undefined ? '' : `: ${outcome.error.message}`),
    };
  }

  // After the story has mounted and before it is read. A story whose image is
  // still in flight is a story whose bytes nobody hashed, and the wait is the
  // driver's because the page cannot see its own requests. Never a failure: a
  // page that keeps fetching is reported, not refused.
  await network?.settle();

  // Either form matches. A subject is `story:case-surface--x` and a story is
  // `case-surface--x`, and `ready` above is keyed by the second — so a
  // declaration written the way the neighbouring option is written has to work,
  // or the escape hatch fails silently and the story it was written for is
  // refused anyway.
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
    // Only the rules that name a selector cross into the page. A fingerprint
    // rule has nothing for a document to resolve, and sending one would put a
    // digest in a browser that cannot use it.
    ...(selectable.length > 0 ? { ignore: selectable } : {}),
    // A story declared as a loading capture waits for nothing: the whole point
    // of it is the fallback, and paying the timeout to be told the boundary is
    // still there would cost five seconds per story to learn what the
    // declaration already said.
    ...(declaredLoading
      ? { suspense: { timeoutMs: 0 } }
      : options.suspenseTimeoutMs !== undefined
        ? { suspense: { timeoutMs: options.suspenseTimeoutMs } }
        : {}),
    // Sent only when the caller said something. The page agent holds the
    // defaults, so a bundle and a driver built from different checkouts cannot
    // disagree about what absent meant.
    ...(options.wiring !== undefined ? { wiring: options.wiring } : {}),
    ...(options.holdings !== undefined ? { holdings: options.holdings } : {}),
    roots,
  };

  // The page's whole observed set goes in there, narrowed inside the page to the
  // URLs this story references: the driver cannot know which of them the story
  // uses, and the page cannot know what the bytes were. Never reset between
  // stories — one page serves the whole run, and a story whose asset was fetched
  // during an earlier story still references it.
  const raw = await acquireFromAgent(page, network, request);

  const acquired = JSON.parse(raw) as Acquired;

  // The symptom of a page agent older than this driver, named rather than read
  // past: `undefined` here would make `suspenseRefusal` throw inside one story
  // and take the run with it, and defaulting it to "settled" would silently
  // restore the behaviour this exists to end.
  if (acquired.suspense === undefined) {
    await recorder?.note(page, planned.subject.id, false);
    return {
      ok: false,
      because:
        'the page agent returned no Suspense reading, which means the bundle in ' +
        '`@variance-authority/storybook-collector` predates it — rebuild the package',
    };
  }

  // The forced decision. A story still showing a fallback is refused with the
  // boundary named, unless somebody declared that this is the subject.
  const unsettled = suspenseRefusal(acquired.suspense, {
    subjectId: planned.subject.id,
    declaredLoading,
  });
  if (unsettled !== undefined) {
    await recorder?.note(page, planned.subject.id, false);
    return { ok: false, because: unsettled };
  }

  await recorder?.note(page, planned.subject.id, true);

  // No frames are spent here, and that is deliberate: a story that settles on
  // its document digest has nobody to hand a location to. They ride the snapshot
  // as provenance — which no hash projects — and `locateSites` spends them for
  // the few nodes a region or a finding names.
  return {
    ok: true,
    document: acquired.document,
    // Normalized here rather than in the page: the ruleset is the one the jsdom
    // path uses, and running it in the browser would make the two profiles two
    // implementations of it.
    // `sourceRoot` for the same reason `scanSource` is rooted at the cwd: both
    // answers name files, and a report that mixes a repository-relative
    // declaration with an absolute call site is one nobody can paste into
    // anything.
    snapshot: normalizeCapture(acquired.capture, { sourceRoot: process.cwd() }),
    ...(acquired.stabilization !== undefined && acquired.stabilization.length > 0
      ? { stabilization: acquired.stabilization }
      : {}),
    ...(source !== undefined ? { source } : {}),
    // No `causes`. Naming the roots of a change needs the *previous* snapshot,
    // and a durable run has a baseline image without one — so ranking falls back
    // to area, which `rankRegions` documents as honest and not good.
  };
}
