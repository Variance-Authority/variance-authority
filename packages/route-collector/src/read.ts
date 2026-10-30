import type { SourceIndex } from '@variance-authority/core/attribute';
import { stepClock, type Diagnostic } from '@variance-authority/core/format';
import { matchesGlob } from '@variance-authority/core/judge';
import { normalize as normalizeCapture } from '@variance-authority/core/rules';
import {
  ARRIVAL_GLOBAL,
  UnansweredAssets,
  acquireFromAgent,
  unresizable,
  unwidened,
} from '@variance-authority/playwright';
import { suspenseRefusal, type HydrationSettlement } from '@variance-authority/react';
import type { Collected, CollectorConfig, PlannedSubject } from './contract.js';
import type { RouteRecorder } from './execution.js';
import { operatorError } from './operator.js';
import type { RouteCollectorOptions } from './options.js';
import type { AcquireRequest, Acquired } from './page-agent.js';
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

/**
 * Chromium's name for a connection nothing accepted: the server is gone, and
 * every route left would be refused the same way. It ends the read with an
 * operator error, not a failure about one route, which would bury the one line
 * that matters under a copy per route and exit as if changes were found. The
 * world is always Chromium, and Playwright carries the net error in its message.
 */
const CONNECTION_REFUSED = 'net::ERR_CONNECTION_REFUSED';

/**
 * The attribute a page carries to leave the run, its value the reason. A page
 * knows it is prose, or a redirect, or a printout; a list in the config would
 * have to learn it again for every page added.
 */
const EXCLUDE_ATTRIBUTE = 'data-variance-exclude';

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
   * with it, and an isolated collection would come back changed everywhere, with
   * the port as the cause, rather than settling anything.
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
  recorder?: RouteRecorder,
): Promise<Collected> {
  const { config, options, routes, roots, portable, source } = reading;
  const { page, engine, region, network } = world;

  const id = planned.subject.id;
  const readyFor = (subject: string): string | undefined => {
    const route = unwidened(subject, options.widths);
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
  const url = routes[unwidened(id, options.widths)];

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

  // Every exit after this point closes the subject's window. A page refused
  // half-way still ran code, in the browser and on the server, and whatever the
  // browser holds would be drained into the next page otherwise.
  const noted = async (complete: boolean): Promise<void> => recorder?.note(page, id, complete, roots);

  // This side's steps, in the order they run, with the page's own spliced in
  // where the page hands them back.
  const steps = stepClock(() => performance.now());

  try {
    // Before the navigation: the request that serves this page is the one that
    // has to carry its journey.
    const journeyed = (await recorder?.join(page, id, url)) ?? false;
    const current = page.viewportSize();
    const resized = current?.width !== wanted.width || current?.height !== wanted.height;

    if (resized) await steps.time('resize', async () => page.setViewportSize({ width: wanted.width, height: wanted.height }));

    // Re-navigated when the size changed, not merely reflowed. CSS reflows on a
    // resize; a component that read `matchMedia` when it mounted does not, and
    // neither does an image chosen by `sizes` at first layout. A page reached by
    // resizing a wider one is therefore not the page a visitor at that width
    // gets, and the difference is invisible in the result — which is the
    // direction this project never accepts.
    if (page.url() !== url || resized || journeyed) {
      // Cleared before the navigation, not after: a route run visits one page
      // per subject, so what this page fetches *is* this subject's asset set.
      // Reusing one page across subjects would make it the union, which
      // over-invalidates rather than under-invalidates.
      network?.reset();
      // `goto` navigates even when the address is unchanged, which is what makes
      // a width change a *load* rather than a reflow.
      await steps.time('navigate', async () => page.goto(url, { waitUntil: 'load' }));
    }

    // Keyed by route, with the widened id winning when it is named. A readiness
    // marker belongs to what the route renders, so an entry under `home` that
    // stopped applying the moment `widths` was added would be a wait nobody
    // asked to lose — silently, since a page that never became ready is captured
    // mid-arrival rather than refused.
    const ready = readyFor(id);
    if (ready !== undefined) {
      await steps.time('ready', async () =>
        page.waitForSelector(ready, {
          timeout: options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
        }),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Only a refused connection ends the read; an empty response or a reset
    // stays this page's failure, since the server answered, once, badly.
    if (message.includes(CONNECTION_REFUSED)) {
      throw operatorError(
        `nothing is listening at ${new URL(url).origin}: the browser's connection was ` +
          `refused while reading \`${id}\` (${url}), and every route left would be ` +
          'refused the same way, so the read stops here. Start the server again, or ' +
          'read its log for why it stopped.',
        { cause: error },
      );
    }

    await noted(false);
    return {
      ok: false,
      because:
        `the route did not become ready at ${url}` +
        (readyFor(id) === undefined ? '' : ` (waiting for ${readyFor(id)})`) +
        `: ${message}`,
    };
  }

  // After readiness, so a marker a client render attaches has arrived, and
  // before anything is read or photographed: a page that leaves the run costs
  // its navigation and nothing more. Read anywhere in the document, not inside
  // the roots, because the page decides for the whole page.
  const exclusion = await page.evaluate(
    (attribute) => document.querySelector(`[${attribute}]`)?.getAttribute(attribute)?.trim() ?? null,
    EXCLUDE_ATTRIBUTE,
  );
  if (exclusion !== null) {
    await noted(false);
    return {
      ok: false,
      excluded: true,
      because: `the page excludes itself (\`${EXCLUDE_ATTRIBUTE}\`)${exclusion === '' ? '' : `: ${exclusion}`}`,
    };
  }

  // After readiness, before reading. `load` fires when the document is parsed,
  // and an image requested by a script that ran on `load` is still in flight —
  // which the page cannot see (it is not in `document.images` yet) and the wire
  // can.
  // One still unanswered at the bound refuses the route, named.
  const unanswered =
    network === undefined ? undefined : await steps.time('network', async () => network.settle());
  if (unanswered !== undefined) {
    await noted(false);
    return { ok: false, because: unanswered };
  }

  await steps.time('agent', async () => world.ensureAgent());

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
    ...region,
    ...(config.fonts !== undefined ? { fonts: config.fonts } : {}),
    // Only the rules that name a selector cross into the page. A fingerprint
    // rule has nothing for a document to resolve, and sending one would put a
    // digest in a browser that cannot use it.
    ...(selectable.length > 0 ? { ignore: selectable } : {}),
    // These fields match the Storybook collector's request on purpose and stay apart:
    // each collector's page agent is its own bundle with its own request type.
    ...(options.stabilize !== undefined ? { stabilize: options.stabilize } : {}),
    ...(world.driven.length > 0 ? { driven: world.driven } : {}),
    // Sent only when the caller said something. The page agent holds the
    // defaults, so a bundle and a driver built from different checkouts cannot
    // disagree about what absent meant.
    ...(options.wiring !== undefined ? { wiring: options.wiring } : {}),
    ...(options.holdings !== undefined ? { holdings: options.holdings } : {}),
    arrival: ARRIVAL_GLOBAL,
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
  const after = stepClock(() => performance.now());
  let raw: string;
  try {
    raw = await acquireFromAgent(page, network, request, after);
  } catch (error) {
    if (!(error instanceof UnansweredAssets)) throw error;
    await noted(false);
    return { ok: false, because: error.message };
  }

  const parsing = stepClock(() => performance.now());
  const acquired = await parsing.time('parse', () => JSON.parse(raw) as Acquired);
  // The page's own steps stand in for the `read` they ran inside, and what is
  // left of it is the answer crossing from the page: `transfer`.
  for (const step of after.taken) {
    if (step.step !== 'read') {
      steps.add([step]);
      continue;
    }
    const inPage = (acquired.steps ?? []).reduce((sum, own) => sum + own.ms, 0);
    steps.add(acquired.steps);
    steps.add([{ step: 'transfer', ms: Math.max(0, Math.round((step.ms - inPage) * 10) / 10) }]);
  }
  steps.add(parsing.taken);

  // The symptom of a page agent older than this driver, named rather than read
  // past: `undefined` here would make `suspenseRefusal` throw inside one route
  // and take the run with it, and defaulting it to "settled" would silently
  // restore the behaviour this exists to end.
  if (acquired.suspense === undefined || (options.wiring !== false && acquired.hydration?.state === undefined)) {
    await noted(false);
    return {
      ok: false,
      because:
        'the page agent returned no Suspense or hydration reading, which means the bundle in ' +
        '`@variance-authority/route-collector` predates it — rebuild the package',
    };
  }

  // Ahead of the Suspense ruling, because it is the cause of that one: a root
  // that has not committed holds no boundary React has finished reading, and a
  // loading declaration would be refused for a tree it could not see.
  const hydrating = acquired.hydration === undefined ? undefined : hydrationRefusal(acquired.hydration, id);
  if (hydrating !== undefined) {
    await noted(false);
    return { ok: false, because: hydrating };
  }

  // The forced decision. A route still showing a fallback is refused with the
  // boundary named, unless somebody declared that this is the subject.
  const unsettled = suspenseRefusal(acquired.suspense, {
    subjectId: planned.subject.id,
    declaredLoading,
  });
  if (unsettled !== undefined) {
    await noted(false);
    return { ok: false, because: unsettled };
  }

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
    await noted(false);
    return {
      ok: false,
      because:
        `${planned.subject.id} cannot be captured as a portable document: ` +
        closure.unresolved.join('; '),
    };
  }

  await noted(true);

  const hydration = acquired.hydration === undefined ? [] : hydrationNotes(acquired.hydration, id);

  // Normalized here rather than in the page: the ruleset is the one the jsdom
  // path uses, and running it in the browser would make the two profiles two
  // implementations of it.
  // `sourceRoot` for the same reason `scanSource` is rooted at the cwd: both
  // answers name files, and a report that mixes a repository-relative
  // declaration with an absolute call site is one nobody can paste into
  // anything.
  const snapshot = await steps.time('normalize', () =>
    normalizeCapture(acquired.capture, { sourceRoot: process.cwd() }),
  );

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
    snapshot,
    ...(acquired.stabilization !== undefined && acquired.stabilization.length > 0
      ? { stabilization: acquired.stabilization }
      : {}),
    ...(hydration.length > 0 ? { diagnostics: hydration } : {}),
    ...(source !== undefined ? { source } : {}),
    steps: steps.taken,
  };
}

/**
 * Why a route React had not finished hydrating must not be recorded, or
 * `undefined` when it had.
 *
 * Refused, not collected, for the reason ADR-0037 refuses a Suspense fallback.
 * The server's markup is not the page a visitor ends on: an effect that runs
 * after hydration — a mounted flag, a theme read from storage, a layout
 * measured on the client — paints a different image, and a baseline taken
 * before it flips with the speed of the machine. The components are missing
 * too, since nothing is read off a render React has not committed.
 */
function hydrationRefusal(settlement: HydrationSettlement, subjectId: string): string | undefined {
  if (settlement.state !== 'hydrating') return undefined;
  return (
    `\`${subjectId}\` stopped hydrating with ${settlement.pending} of ${settlement.roots} React ` +
    'root(s) uncommitted: React had no work it could do, and nothing the page requested was ' +
    'still arriving to give it some. A root holds like that on a promise the wire does not ' +
    'settle — one settled by a timer, one whose request failed, one never settled — read ' +
    'outside any <Suspense>. An effect that runs after hydration can paint a different image, ' +
    'so the server\'s markup is not recorded in its place. Find the promise the first ' +
    'render holds on.'
  );
}

/**
 * What hydration says about a route that was read: why it names no component,
 * and whether React changed the markup after the hydration commit.
 *
 * Collected rather than refused: no React is a page this run can compare, and
 * a static page or a client that never started is a page somebody may mean to
 * test. What must not happen is the absence passing unsaid, because without
 * this line a route with no React reads the same as a node no component wrote.
 *
 * A change is a warning for the same reason. The reading is of the page the
 * visitor ends on, so the image is right; the route still shows the visitor
 * the server's page first and then another one, which no image of either says.
 */
function hydrationNotes(settlement: HydrationSettlement, subjectId: string): Diagnostic[] {
  const notes: Diagnostic[] = [];
  if (settlement.state === 'unrooted') {
    notes.push({
      severity: 'warn',
      code: 'react-root-absent',
      message:
        settlement.loaded === false
          ? `React had not loaded on ${subjectId} once nothing the page requested was still ` +
            'arriving, so its components were not read. Set `wiring: false` when React does not ' +
            'render these routes.'
          : `No React root was found on, above or under ${subjectId}, and nothing the page ` +
            'requested was still arriving, so its components were not read. Either React does ' +
            'not render this route, or its client creates a root on something other than a ' +
            'response: a timer, an effect, an interaction. Set `wiring: false` when React does not render ' +
            'these routes.',
    });
  }
  const changed = settlement.changed;
  if (changed !== undefined) {
    const by = changed.components === undefined ? '' : ` ${changed.components.join(', ')} committed after hydrating.`;
    notes.push({
      severity: 'warn',
      code: 'hydration-changed-markup',
      message:
        `Hydration changed the markup of ${subjectId}: the hydration commit left \`${changed.before}\` and the ` +
        `client then left \`${changed.after}\`.${by} The reading is of the page after hydration; a ` +
        'visitor sees the server\'s page first. Render the same markup on the server, or move ' +
        'the difference into a client-only component.',
    });
  }
  return notes;
}
