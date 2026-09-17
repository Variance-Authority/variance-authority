import type { SourceIndex } from '@variance-authority/core/attribute';
import { matchesGlob } from '@variance-authority/core/judge';
import { normalize as normalizeCapture } from '@variance-authority/core/rules';
import { acquireFromAgent, unresizable } from '@variance-authority/playwright';
import { suspenseRefusal } from '@variance-authority/react';
import type { Collected, CollectorConfig, PlannedSubject } from './contract.js';
import type { RouteCollectorOptions } from './options.js';
import type { AcquireRequest, Acquired } from './page-agent.js';
import { routeOf } from './widths.js';
import type { RouteWorld } from './world.js';

/**
 * One route, read out of a world — which world being the only variable.
 *
 * Split out of `index.ts` so `collect` and `collectAlone` are the *same*
 * reading. Every input to a `Collected` other than the world is in
 * {@link RouteReading}, computed once per collector and handed to both: the
 * route table, the viewport, the ready selector, the ignore rules narrowed to
 * this subject, the loading declaration, the stabilization recipe, the wiring
 * and holdings flags, the suspense budget, the roots, the portability claim and
 * the source index. A second copy of this body would let one of them drift, and
 * a drifted input produces a difference an operator reads as pollution when it
 * is really a different recipe.
 */

const DEFAULT_READY_TIMEOUT_MS = 10_000;

export interface RouteReading {
  readonly config: CollectorConfig;
  readonly options: RouteCollectorOptions;

  /**
   * Subject id to address, declared or discovered.
   *
   * Resolved per call rather than frozen at construction, because `plan()` is
   * what fills it for a discovered run — and where a directory is being served,
   * both worlds get the addresses that name *that* server. A second server would
   * answer on a second port, every asset URL would move, the environment key
   * with it, and an isolated collection would come back `incomparable` rather
   * than settling anything.
   */
  readonly routes: Readonly<Record<string, string>>;
  readonly roots: readonly string[];
  readonly portable: boolean;
  readonly source?: SourceIndex;
}

export async function readRoute(
  world: RouteWorld,
  reading: RouteReading,
  planned: PlannedSubject,
): Promise<Collected> {
  const { config, options, routes, roots, portable, source } = reading;
  const { page, engine, network } = world;

  const id = planned.subject.id;
  const readyFor = (subject: string): string | undefined => {
    const route = routeOf(subject, options.widths);
    const declared = Object.entries(options.ready ?? {});
    // A literal key first, then a pattern. `matchesGlob` escapes everything but
    // `*` and `?`, so a key that names one subject still matches only itself and
    // the lookup below finds it — the pattern pass exists for a site whose
    // framework attaches the same marker to every page, where writing the map
    // out is five hundred copies of one line that drift apart. Declaration
    // order decides between two patterns that both match: narrow first.
    return (
      options.ready?.[subject] ??
      options.ready?.[route] ??
      declared.find(
        ([pattern]) => matchesGlob(subject, pattern) || matchesGlob(route, pattern),
      )?.[1]
    );
  };
  // `route/home@375` is one width of `route/home`, and the URL belongs to the
  // route. Resolved here rather than by rewriting the plan's ids, because the id
  // is what a baseline, a report line and a `--subjects` glob all name — and
  // those have to stay distinct per width.
  const url = routes[routeOf(id, options.widths)];

  // Reported, never dropped. An id in the plan with no route here is a hole in
  // this run's coverage, and a run that observes 29 of 30 subjects and says
  // nothing about the 30th is the silence this project refuses.
  if (url === undefined) {
    return { ok: false, because: `no route is configured for \`${id}\`` };
  }

  const wanted = planned.viewport ?? config.viewport;

  // A context's scale factor and colour scheme are fixed when it is created, so
  // a subject asking for different ones cannot be honoured by resizing — and
  // painting it at the run's values while *recording* its own would put a lie in
  // the environment key, which is the one field everything else trusts. Refused
  // by name instead.
  const fixed = unresizable(wanted, config.viewport);
  if (fixed !== undefined) return { ok: false, because: fixed };

  try {
    const current = page.viewportSize();
    const resized = current?.width !== wanted.width || current?.height !== wanted.height;

    if (resized) await page.setViewportSize({ width: wanted.width, height: wanted.height });

    // Re-navigated when the size changed, not merely reflowed. CSS reflows on a
    // resize; a component that read `matchMedia` when it mounted does not, and
    // neither does an image chosen by `sizes` at first layout. A page reached by
    // resizing a wider one is therefore not the page a visitor at that width
    // gets, and the difference is invisible in the result — which is the
    // direction this project never accepts.
    if (page.url() !== url || resized) {
      // Cleared before the navigation, not after: a route run visits one page
      // per subject, so what this page fetches *is* this subject's asset set.
      // Reusing one page across subjects would make it the union, which
      // over-invalidates rather than under-invalidates.
      network?.reset();
      // `goto` navigates even when the address is unchanged, which is what makes
      // a width change a *load* rather than a reflow.
      await page.goto(url, { waitUntil: 'load' });
    }

    // Keyed by route, with the widened id winning when it is named. A readiness
    // marker belongs to what the route renders, so an entry under `home` that
    // stopped applying the moment `widths` was added would be a wait nobody
    // asked to lose — silently, since a page that never became ready is captured
    // mid-arrival rather than refused.
    const ready = readyFor(id);
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
        (readyFor(id) === undefined ? '' : ` (waiting for ${readyFor(id)})`) +
        `: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // After readiness, before reading. `load` fires when the document is parsed,
  // and an image requested by a script that ran on `load` is still in flight —
  // which the page cannot see (it is not in `document.images` yet) and the wire
  // can.
  await network?.settle();

  await world.ensureAgent();

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
    // Only the rules that name a selector cross into the page. A fingerprint
    // rule has nothing for a document to resolve, and sending one would put a
    // digest in a browser that cannot use it.
    ...(selectable.length > 0 ? { ignore: selectable } : {}),
    ...(options.stabilize !== undefined ? { stabilize: options.stabilize } : {}),
    // Sent only when the caller said something. The page agent holds the
    // defaults, so a bundle and a driver built from different checkouts cannot
    // disagree about what absent meant.
    ...(options.wiring !== undefined ? { wiring: options.wiring } : {}),
    ...(options.holdings !== undefined ? { holdings: options.holdings } : {}),
    // A subject declared as a loading capture waits for nothing: the whole point
    // of it is the fallback, and paying the timeout to be told the boundary is
    // still there would cost five seconds per route to learn what the
    // declaration already said.
    ...(declaredLoading
      ? { suspense: { timeoutMs: 0 } }
      : options.suspenseTimeoutMs !== undefined
        ? { suspense: { timeoutMs: options.suspenseTimeoutMs } }
        : {}),
    roots,
  };

  // The assets are its business, not this request's: they are read from the wire
  // and they keep arriving while the page is being held still.
  const raw = await acquireFromAgent(page, network, request);

  const acquired = JSON.parse(raw) as Acquired;

  // The symptom of a page agent older than this driver, named rather than read
  // past: `undefined` here would make `suspenseRefusal` throw inside one route
  // and take the run with it, and defaulting it to "settled" would silently
  // restore the behaviour this exists to end.
  if (acquired.suspense === undefined) {
    return {
      ok: false,
      because:
        'the page agent returned no Suspense reading, which means the bundle in ' +
        '`@variance-authority/route-collector` predates it — rebuild the package',
    };
  }

  // The forced decision. A route still showing a fallback is refused with the
  // boundary named, unless somebody declared that this is the subject.
  const unsettled = suspenseRefusal(acquired.suspense, {
    subjectId: planned.subject.id,
    declaredLoading,
  });
  if (unsettled !== undefined) return { ok: false, because: unsettled };

  // No frames are spent here, and that is deliberate: a route that settles on
  // its document digest has nobody to hand a location to. They ride the snapshot
  // as provenance — which no hash projects — and `locateSites` spends them for
  // the few nodes a region or a finding names.
  // The portability claim is made here, where the URLs still mean something, or
  // it is not made at all. A document that reaches a renderer claiming closure
  // it does not have fails on digest verification in another process on another
  // machine.
  const closure = portable ? network?.closure() : undefined;
  if (closure !== undefined && !closure.ok) {
    return {
      ok: false,
      because:
        `${planned.subject.id} cannot be captured as a portable document: ` +
        closure.unresolved.join('; '),
    };
  }

  return {
    ok: true,
    document:
      closure === undefined
        ? acquired.document
        : {
            ...acquired.document,
            // Carried with the bytes, and load-bearing for them. The resource
            // map is keyed by absolute URL because that is what the wire saw,
            // while the captured HTML holds whatever the author wrote — usually
            // `/logo.svg`. Without a base, a later render resolves that against
            // the renderer's own blank page, requests nothing, finds nothing
            // missing, and paints a document with a hole in it. `page.url()`
            // rather than the planned address, so a redirect is recorded where
            // it landed.
            baseUrl: page.url(),
            resources: closure.resources,
          },
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
  };
}
