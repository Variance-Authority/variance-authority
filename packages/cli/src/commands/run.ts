import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  documentDigest,
  formatSource,
  profileById,
  rankRegions,
  resolveSource,
  type Digest,
  type RankedRegion,
  type RenderDocument,
  type RenderIdentity,
  type SemanticSnapshot,
  type SourceIndex,
  type SubjectRef,
  type Viewport,
} from '@variance-authority/core';
import {
  DEFAULT_POLICY,
  RasterStoreError,
  STRICT_POLICY,
  createDurableStore,
  createEphemeralStore,
  createLfsStore,
  createRemoteStore,
  diffImage,
  decode,
  observeAgainstBaseline,
  observePair,
  type BaselineKey,
  type Found,
  type Observation,
  type RasterStore,
  type Renderer,
} from '@variance-authority/raster';
import type { Raster } from '@variance-authority/core';
import { readStoryIndex, storySubjectId, toSubjects } from '@variance-authority/storybook';
import {
  readRunReport,
  writeRunReport,
  type ObservationRecord,
  type RegionRecord,
  type RunReport,
} from '@variance-authority/mcp';
import type { Config } from '../config.js';
import { OperatorError } from '../exit.js';

/**
 * `variance run` — collect, decide, and write down what was decided.
 *
 * Two properties of this command are worth more than everything else in it, and
 * both are properties of what it *refuses* to do.
 *
 * **It renders only what the cheaper tiers could not settle.** Rasterization
 * costs ~65ms against ~3.4ms for a semantic collection of the same page
 * (ADR-0010), and a suite is three hundred subjects of which two changed. The
 * lever is content addressing: a `RenderDocument` is a complete statement of what
 * is to be painted, so if the digest of this run's document equals the digest the
 * stored baseline was painted from, *under the same renderer identity*, then
 * repainting it can only reproduce the same image. That is a settlement, not a
 * guess, and it is the argument {@link settle} makes.
 *
 * **It states every subject it did not observe.** Silence about a subject is
 * indistinguishable from a pass, and a suite that quietly stops observing a
 * component is worse than no suite — it is a green check over an unwatched
 * surface. So the report carries a second list beside the observations, every
 * entry of which has a reason, and `exitFor` refuses to say "nothing needs
 * review" while it contains a subject the run meant to see and could not.
 */

/**
 * Why a subject is in the report without an observation.
 *
 * Two kinds, kept apart because they mean opposite things about whether anyone
 * should act. `excluded` is a decision the operator already made and wrote down;
 * `failed` is a hole in this run's coverage. Collapsing them would either make
 * every configured exclusion permanently red — which ends with the exclusion list
 * being deleted rather than read — or make a browser that crashed on subject 41
 * look like a subject somebody chose to skip.
 */
export type NotObservedKind = 'excluded' | 'failed';

export interface NotObserved {
  readonly subject: string;
  readonly kind: NotObservedKind;
  /** One sentence, ready to print, naming what was not looked at and why. */
  readonly because: string;
}

/**
 * The run report as this CLI writes it: `RunReport` plus the coverage it cannot
 * express.
 *
 * A superset rather than a change to `@variance-authority/mcp`'s type, so an MCP
 * server reads a CLI report unmodified and every tool in that package keeps
 * working. The extra fields are the two things a *command line* has to answer and
 * an agent's question does not: what was skipped, and what the index complained
 * about on the way in.
 */
export interface CliRunReport extends RunReport {
  /**
   * Subjects with no observation. **Absent is not empty** — see `exitFor`.
   *
   * Optional in the type only because a report written by something other than
   * this CLI will not have it, and the reader must be able to tell "none" from
   * "the writer never said".
   */
  readonly notObserved?: readonly NotObserved[];

  /** Complaints from the subject index that belong to no single subject. */
  readonly warnings?: readonly string[];
}

/**
 * A subject the run intends to observe.
 *
 * One image per subject, deliberately. `BaselineKey` carries a `label` so that a
 * subject can have several images, and this command does not use it: observations
 * in a run report are keyed by subject id, so two records sharing an id would
 * make `variance_describe` ambiguous about which image it is describing, and
 * `accept <subject>` ambiguous about which one it promotes. A subject observed at
 * two viewports is two subjects, with two ids the operator chose.
 */
export interface PlannedSubject {
  readonly subject: SubjectRef;
  /** Overrides the run's viewport, when the subject declared its own. */
  readonly viewport?: Viewport;
}

export interface Plan {
  readonly subjects: readonly PlannedSubject[];
  /** Subjects the plan itself refuses. Reported, never dropped. */
  readonly notObserved: readonly NotObserved[];
  readonly warnings: readonly string[];
}

/**
 * Everything the cheap tiers produced for one subject, or the reason there is
 * nothing.
 *
 * `ok: false` is not an exception. One subject that cannot be mounted must not
 * cost the other 299 their observations, and it must not be silently absent
 * either — so it travels as a value with a sentence attached.
 */
export type Collected =
  | {
      readonly ok: true;
      readonly document: RenderDocument;
      /**
       * The other side, for an ephemeral comparison.
       *
       * Ephemeral retention renders both images in one run so the machine cancels
       * out by construction (ADR-0011). That requires the collector to be able to
       * produce the previous revision's document, which is a thing only the
       * project knows how to do.
       */
      readonly before?: RenderDocument;
      /** The normalized snapshot of the same render; without it regions have no names. */
      readonly snapshot?: SemanticSnapshot;
      /**
       * Components the semantic tier named as *roots* of the change.
       *
       * Passed to `rankRegions`, which is the difference between a report led by
       * the edit and one led by whatever the edit pushed around. Absent means the
       * ordering falls back to area, which that function documents as honest and
       * not good.
       */
      readonly causes?: readonly string[];
      readonly source?: SourceIndex;
    }
  | { readonly ok: false; readonly because: string };

/**
 * The half of a run this package cannot write.
 *
 * A story index is a file with a documented shape, so planning is generic.
 * Mounting a project's components, waiting for them to be ready, and serializing
 * the result is not: it needs the project's own bundle, its own providers, and
 * its own definition of settled. Every tool that has claimed otherwise grew a
 * plugin system whose failures are undebuggable from either side.
 *
 * So the config names a module, this CLI imports it, and the contract is four
 * methods. An operator writes about thirty lines; in exchange, nothing in this
 * file has to guess what a subject is.
 */
export interface Collector {
  /** Subjects to observe, plus the ones this source already refuses, with reasons. */
  plan(): Promise<Plan>;
  collect(subject: PlannedSubject): Promise<Collected>;
  close(): Promise<void>;
}

/** What the collector module's default export is called with. */
export interface CollectorContext {
  readonly config: Config;
  /** Present only for `subjects.kind: 'storybook'`; already read and planned. */
  readonly plan?: Plan;
}

export type SubjectSource = (context: CollectorContext) => Promise<Collector>;

export interface RunDeps {
  readonly collector: Collector;
  readonly store: RasterStore;
  /**
   * Opened once, on first need.
   *
   * The laziness is not about the launch. A durable lookup is scoped by renderer
   * identity, so the identity has to be known before the first `find`, and this
   * is therefore called at the start of any durable run — 205ms, once (journal
   * 0007). What it saves is the per-subject rasterization, which is the cost that
   * scales with the suite.
   */
  renderer(): Promise<Renderer>;
  /** ISO 8601. Injected because nothing in a report should come from a hidden clock. */
  now(): string;
  /** Writes candidate images. Injected so the run loop is testable with no disk. */
  writeArtifact(path: string, bytes: Buffer): Promise<void>;
  writeReport(path: string, report: CliRunReport): Promise<void>;
}

export interface RunOptions {
  readonly config: Config;
  readonly deps: RunDeps;
  /** `--intent`, overriding the config's. */
  readonly intent?: string;
  /** `--subjects`. Non-matching subjects are listed as excluded, never dropped. */
  readonly subjects?: string;
}

/**
 * What the cheap tiers concluded about one subject before any pixel was paid for.
 */
export type Settlement =
  | {
      readonly kind: 'settled';
      readonly verdict: ObservationRecord['verdict'];
      readonly because: string;
    }
  | { readonly kind: 'render'; readonly because: string };

/**
 * Decide whether this subject needs an image, from the baseline alone.
 *
 * Three answers, and the first is the one that pays for this whole design.
 *
 * **The document digest matches.** `documentDigest` covers the markup, the
 * applicable CSS in cascade order, the frame, the inherited floor, the viewport
 * including its scale factor, and the declared fonts — that is, everything sent
 * to a renderer. The baseline's sidecar records which digest it was painted from.
 * If they are equal and `comparable` says one machine painted both, then painting
 * it again is a function applied twice to the same input. The texture band is
 * settled without a browser touching it.
 *
 * *What that costs.* It assumes the renderer is deterministic given a document
 * and an identity. A page with a CSS animation, a video frame, or a `Math.random`
 * background defeats it — and defeats a re-render too, which would report a
 * change with no cause. That is the `unexplained` verdict's territory, and it is
 * not made worse here; but a suite full of animation will settle to `unchanged`
 * on inputs that genuinely repaint differently, and the honest place to fix that
 * is the document, with `AssembleOptions.extraCss`.
 *
 * **The baseline is another machine's.** Refused rather than rendered. Producing
 * the image would buy a diff nobody is permitted to read, since pixels are
 * machine-bound and the difference would be attributed to whichever component
 * happens to sit under it (ADR-0011).
 *
 * **Anything else renders.** Including `new`, where the *verdict* is already
 * settled — there is no baseline, and no image changes that. It renders anyway,
 * and this is the one place the run pays for a render it does not need for the
 * verdict: without the image there is nothing for `accept` to promote, and
 * `accept` is forbidden to re-run. Stated here rather than hidden, because it is
 * the single exception to the rule this function otherwise enforces.
 */
export function settle(digest: Digest, found: Found | null): Settlement {
  if (found === null) {
    return {
      kind: 'render',
      because: 'no baseline exists, so there is no digest to compare this document against',
    };
  }

  if (!found.comparable) {
    return {
      kind: 'settled',
      verdict: 'incomparable',
      because:
        `a baseline exists but was rendered by ${describeIdentity(found.storedUnder)}; ` +
        'pixels are machine-bound, so the two are not comparable and no image was produced',
    };
  }

  if (found.raster.documentDigest === digest) {
    return {
      kind: 'settled',
      verdict: 'unchanged',
      because:
        'the document this run assembled is byte-identical to the one the baseline was ' +
        'painted from, under the same renderer identity, so no image was produced',
    };
  }

  return {
    kind: 'render',
    because: 'the document differs from the one the baseline was painted from',
  };
}

/**
 * Glob over subject ids: `*` any run of characters, `?` exactly one.
 *
 * Deliberately not path-aware. A subject id is `story:components-button--primary`
 * — a namespaced identifier, not a filename — and treating `/` specially would
 * make `*` stop at a separator that carries no meaning here.
 */
export function matchesGlob(pattern: string, id: string): boolean {
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, (character) =>
    character === '*' ? '[\\s\\S]*' : character === '?' ? '[\\s\\S]' : `\\${character}`,
  );
  return new RegExp(`^${source}$`).test(id);
}

/**
 * The observation as the report records it.
 *
 * Exported because this mapping is where information gets lost if anyone is
 * careless, and it is worth testing on a hand-built `Observation` rather than
 * only behind a browser.
 */
export function recordOf(
  observation: Observation,
  options: {
    readonly causes?: readonly string[];
    readonly source?: SourceIndex;
    readonly images?: ObservationRecord['images'];
  } = {},
): ObservationRecord {
  const changed = observation.comparison?.changed[DEFAULT_POLICY.id] ?? 0;
  const strict = observation.comparison?.changed[STRICT_POLICY.id] ?? 0;
  const regions = rankRegions(observation.regions, options.causes ?? []);
  const truncated = observation.isolation;

  return {
    subject: observation.subject,
    verdict: observation.verdict,
    because: because(observation, changed, strict),
    changedPixels: changed,
    regions: regions.map((region) => regionRecordOf(region, options.source)),
    ...(truncated !== undefined && truncated.truncated > 0
      ? { truncated: { regions: truncated.truncated, pixels: truncated.truncatedPixels } }
      : {}),
    ...(observation.missingFonts.length > 0 ? { missingFonts: observation.missingFonts } : {}),
    ...(options.images !== undefined ? { images: options.images } : {}),
  };
}

/**
 * The sentence, with the forgiven pixels added back.
 *
 * `DEFAULT_POLICY` forgives antialiasing, which is what every deployed pixel
 * differ does and why "zero pixels changed" is not the same claim as "the images
 * are identical". When the strict policy disagrees, the disagreement is stated:
 * an unobservable difference is never reported as no difference, and a difference
 * that is only visible under a stricter reading is exactly that.
 */
function because(observation: Observation, changed: number, strict: number): string {
  if (observation.verdict !== 'unchanged' || strict <= changed) return observation.because;

  return (
    `${observation.because}; ${strict} pixel(s) do differ under the strict policy ` +
    '(antialiasing counted), which the default policy forgives'
  );
}

function regionRecordOf(region: RankedRegion, source?: SourceIndex): RegionRecord {
  const resolved =
    source !== undefined && region.component !== undefined
      ? resolveSource(region.component, source)
      : null;

  if (region.unattributed) {
    // `nearest` is orientation and never attribution, so it is not written into
    // `component` — a trace tool would then count this as an appearance of a
    // component no box actually contained. It goes into the landmark phrase
    // instead, where it reads as "what this is near" and nothing more.
    const near = region.nearest;
    const phrase =
      near === undefined
        ? undefined
        : `near ${near.component ?? near.path}${near.where !== undefined ? ` (${near.where})` : ''}`;

    return {
      x: region.region.x,
      y: region.region.y,
      width: region.region.width,
      height: region.region.height,
      pixels: region.region.pixels,
      cause: region.cause,
      unattributed: true,
      ...(phrase !== undefined ? { where: phrase } : {}),
    };
  }

  return {
    x: region.region.x,
    y: region.region.y,
    width: region.region.width,
    height: region.region.height,
    pixels: region.region.pixels,
    cause: region.cause,
    ...(region.component !== undefined ? { component: region.component } : {}),
    ...(region.path !== undefined ? { path: region.path } : {}),
    ...(region.where !== undefined ? { where: region.where } : {}),
    ...(resolved !== null ? { file: formatSource(resolved) } : {}),
  };
}

/**
 * Run, and write the report.
 *
 * The loop is deliberately flat and the interesting decisions are all in named
 * functions above it, because this is the place a reader comes to answer "why was
 * my subject not in the output" and that question must be answerable by reading
 * one screen.
 */
export async function run(options: RunOptions): Promise<CliRunReport> {
  const { config, deps } = options;
  const profile = profileById(config.profile);

  const plan = await deps.collector.plan();
  const observations: ObservationRecord[] = [];
  const notObserved: NotObserved[] = [...plan.notObserved];

  // The profile describes the *collector*, not the renderer. `--profile jsdom`
  // with a renderer is the sub-renderer split document.ts route 1 exists for: the
  // cheap tier decides almost everything and hands the residue to something that
  // owns a GPU. What it costs is stated here rather than discovered from a report
  // full of coordinates with no names — attribution joins regions to boxes, and a
  // profile with no layout engine has no boxes to join them to (ADR-0002).
  const warnings = [
    ...plan.warnings,
    ...(profile.layout
      ? []
      : [
          `the \`${config.profile}\` profile has no layout engine, so no changed region in ` +
            'this report could be joined to the node that occupies it; every region is ' +
            'reported unattributed rather than attributed to a guess',
        ]),
  ];

  // Opened once, before the first lookup, because a durable baseline is stored
  // per renderer identity and a run that guessed one would read another
  // machine's directory. Deferring the *launch* was never the saving on offer:
  // it is 205ms once, against ~65ms of rasterization per subject (journal 0007,
  // ADR-0010). What this command defers is the per-subject render, and that is
  // what `settle` is for.
  const renderer = await deps.renderer();

  for (const planned of plan.subjects) {
    const id = planned.subject.id;

    if (options.subjects !== undefined && !matchesGlob(options.subjects, id)) {
      notObserved.push({
        subject: id,
        kind: 'excluded',
        because: `did not match --subjects ${options.subjects}`,
      });
      continue;
    }

    const collected = await deps.collector.collect(planned);
    if (!collected.ok) {
      notObserved.push({ subject: id, kind: 'failed', because: collected.because });
      continue;
    }

    try {
      const outcome = await observeOne(planned, collected, { config, deps, renderer });

      if (outcome.kind === 'observed') observations.push(outcome.record);
      else notObserved.push(outcome.entry);
    } catch (error) {
      if (error instanceof RasterStoreError) {
        // Spec 0004: a store failure is not a verdict. Reporting an unreachable
        // endpoint as `new` would make the next `accept` overwrite the only copy
        // of what the subject looked like before, while reporting success.
        throw new OperatorError(
          `the baseline store failed while observing \`${id}\`: ${messageOf(error)}. ` +
            'No verdict was reached and no baseline was written.',
          { cause: error },
        );
      }
      // Anything else is about this subject, not about the run. Recorded and the
      // run continues: one component that throws must not cost the other 299
      // their observations.
      notObserved.push({
        subject: id,
        kind: 'failed',
        because: `observing it failed: ${messageOf(error)}`,
      });
    }
  }

  const intent = options.intent ?? config.intent;

  const report: CliRunReport = {
    runVersion: 1,
    at: deps.now(),
    identity: renderer.identity,
    retention: config.retention,
    ...(intent !== undefined ? { intent } : {}),
    observations,
    notObserved,
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  await deps.writeReport(config.report, report);
  return report;
}

interface ObserveContext {
  readonly config: Config;
  readonly deps: RunDeps;
  readonly renderer: Renderer;
}

type Outcome =
  | { readonly kind: 'observed'; readonly record: ObservationRecord }
  | { readonly kind: 'not-observed'; readonly entry: NotObserved };

async function observeOne(
  planned: PlannedSubject,
  collected: Extract<Collected, { ok: true }>,
  context: ObserveContext,
): Promise<Outcome> {
  const { config, deps, renderer } = context;
  const id = planned.subject.id;

  const observeOptions = {
    renderer,
    store: deps.store,
    ...(collected.snapshot !== undefined ? { snapshot: collected.snapshot } : {}),
    ...(collected.source !== undefined ? { source: collected.source } : {}),
  };

  if (config.retention === 'ephemeral') {
    if (collected.before === undefined) {
      return {
        kind: 'not-observed',
        entry: {
          subject: id,
          kind: 'failed',
          because:
            'ephemeral retention compares two renders made in this run, and the collector ' +
            'supplied no previous-revision document for this subject; nothing was observed',
        },
      };
    }

    const observation = await observePair(
      collected.before,
      collected.document,
      observeOptions,
    );
    return {
      kind: 'observed',
      record: recordOf(observation, {
        ...(collected.causes !== undefined ? { causes: collected.causes } : {}),
        ...(collected.source !== undefined ? { source: collected.source } : {}),
        ...(await images(id, observation, collected.document, renderer, config, deps, null)),
      }),
    };
  }

  const key: BaselineKey = { subject: id };

  // The settlement query. When it does not settle, the observation pipeline runs
  // and looks the baseline up again — one extra lookup per unsettled subject,
  // paid so that comparison, isolation, and attribution are not reimplemented
  // here where they would be a second, untested copy.
  const found = await deps.store.find(key, renderer.identity);
  const settlement = settle(documentDigest(collected.document), found);

  if (settlement.kind === 'settled') {
    return {
      kind: 'observed',
      record: {
        subject: id,
        verdict: settlement.verdict,
        because: settlement.because,
        changedPixels: 0,
        regions: [],
      },
    };
  }

  const observation = await observeAgainstBaseline(collected.document, key, observeOptions);

  return {
    kind: 'observed',
    record: recordOf(observation, {
      ...(collected.causes !== undefined ? { causes: collected.causes } : {}),
      ...(collected.source !== undefined ? { source: collected.source } : {}),
      ...(await images(id, observation, collected.document, renderer, config, deps, found)),
    }),
  };
}

/**
 * Write the candidate image, its sidecar, and a diff — and say where they went.
 *
 * The image is what makes a subject *acceptable*. `accept` is forbidden to
 * re-run, so if the run does not leave the bytes behind, the only way to promote
 * a reviewed change is to render it again on a machine that may no longer be the
 * same one — which is the failure the identity partition exists to prevent.
 *
 * The sidecar carries the `Raster` minus its bytes, in the same `<name>.png` /
 * `<name>.json` pairing the durable store itself uses. Without it `accept` would
 * have to invent a width, a scale, and a document digest for the baseline it
 * writes, and an invented digest defeats {@link settle} on every later run.
 */
async function images(
  id: string,
  observation: Observation,
  document: RenderDocument,
  renderer: Renderer,
  config: Config,
  deps: RunDeps,
  found: Found | null,
): Promise<{ images?: ObservationRecord['images'] }> {
  const raster = await candidateRaster(deps.store, document, renderer);
  if (raster === null) return {};

  const base = join(config.images, encodeURIComponent(id));
  const reportDir = dirname(config.report);

  await deps.writeArtifact(`${base}.after.png`, decode(raster.bytes));
  await deps.writeArtifact(
    `${base}.after.json`,
    Buffer.from(`${JSON.stringify({ ...raster, bytes: undefined }, null, 2)}\n`, 'utf8'),
  );

  const before = found?.raster;
  if (before === undefined || observation.verdict !== 'changed') {
    // No `before` means nothing to subtract from, so a diff image would be the
    // candidate itself painted red. Omitted rather than written, and its absence
    // is visible in the record, which lists exactly the images that exist.
    return { images: { after: relative(reportDir, `${base}.after.png`) } };
  }

  await deps.writeArtifact(`${base}.before.png`, decode(before.bytes));
  await deps.writeArtifact(
    `${base}.diff.png`,
    diffImage(decode(before.bytes), decode(raster.bytes)),
  );

  return {
    images: {
      before: relative(reportDir, `${base}.before.png`),
      after: relative(reportDir, `${base}.after.png`),
      diff: relative(reportDir, `${base}.diff.png`),
    },
  };
}

/**
 * Recover the image the pipeline just produced, from the store's own render cache.
 *
 * Read back rather than threaded out of `Observation`, which deliberately carries
 * no bytes — a 300-subject report holding two PNGs per subject in memory is the
 * shape that makes this tool unusable on a real suite. The cache has them under
 * the document's digest, so this is a lookup, not a render.
 *
 * **Two keys, and the reason is a seam in the tier below.** `renderCached` reads
 * the cache under the *renderer's* identity and writes it under the *raster's*,
 * and those differ in exactly one field: a renderer reports `deviceScaleFactor: 1`
 * until it knows the document, whose viewport supplies the real one. At 1x they
 * coincide and the first key hits. Above 1x only the second does. Trying both is
 * two cheap lookups; guessing one would silently lose every image on a 2x run,
 * and a missing image is a subject that cannot be accepted.
 *
 * `null` is a real answer — some renderer or store combination kept nothing — and
 * it produces a record with no `images`, which `accept` later refuses by name
 * rather than by re-rendering.
 */
async function candidateRaster(
  store: RasterStore,
  document: RenderDocument,
  renderer: Renderer,
): Promise<Raster | null> {
  const digest = documentDigest(document);
  const scaled: RenderIdentity = {
    ...renderer.identity,
    deviceScaleFactor: document.viewport.deviceScaleFactor,
  };

  return (await store.cached(digest, scaled)) ?? (await store.cached(digest, renderer.identity));
}

/**
 * Plan a run from a built Storybook's index.
 *
 * The generic half. Reading a declared index and applying exclusion policy needs
 * no browser, so it happens here where it can be tested — and every story the
 * index declared that this run will not observe becomes a `notObserved` entry
 * with the adapter's own reason attached.
 */
export async function planStorybook(
  indexPath: string,
  viewport: Viewport,
  excludeTags?: readonly string[],
): Promise<Plan> {
  const index = await readStoryIndex(indexPath);
  const plan = toSubjects(index, {
    viewport,
    ...(excludeTags !== undefined ? { excludeTags } : {}),
  });

  return {
    subjects: plan.subjects.map((story) => ({
      subject: story.subject,
      ...(story.viewport !== undefined ? { viewport: story.viewport } : {}),
    })),
    notObserved: plan.excluded.map((entry) => ({
      subject: storySubjectId(entry.id),
      kind: 'excluded' as const,
      because: entry.reason,
    })),
    warnings: plan.warnings,
  };
}

/** Plan a run from an explicit list. Nothing is excluded; the operator wrote it. */
export function planList(ids: readonly string[]): Plan {
  return {
    subjects: ids.map((id) => ({ subject: { id, kind: 'fixture' as const } })),
    notObserved: [],
    warnings: [],
  };
}

/**
 * Import the operator's collector module.
 *
 * A local file, imported by path. Not a download and not a registry lookup — the
 * module is in the operator's repository, was reviewed like the rest of it, and
 * is named in the config rather than discovered.
 */
export async function loadCollector(
  path: string,
  context: CollectorContext,
): Promise<Collector> {
  let module: { readonly default?: unknown };
  try {
    module = (await import(pathToFileURL(path).href)) as { readonly default?: unknown };
  } catch (error) {
    throw new OperatorError(
      `cannot load the collector module ${path}: ${messageOf(error)}`,
      { cause: error },
    );
  }

  const source = module.default;
  if (typeof source !== 'function') {
    throw new OperatorError(
      `${path} must default-export a function (context) => Promise<Collector>; ` +
        'it exports ' +
        (source === undefined ? 'nothing' : typeof source),
    );
  }

  return (source as SubjectSource)(context);
}

/**
 * The store the config asks for.
 *
 * Switching implementations must change no verdict for the same inputs (spec
 * 0004), which is why every durable variant is built on `createDurableStore`'s
 * layout rather than reimplementing the identity partition.
 */
export async function storeFor(config: Config): Promise<RasterStore> {
  if (config.retention === 'ephemeral') return createEphemeralStore();

  const baselines = config.baselines;
  if (baselines === undefined) {
    // `parseConfig` refuses this combination, so reaching it means the config was
    // built in code. Still refused rather than defaulted: a durable run that
    // invented a baseline root would compare against a directory nobody chose.
    throw new OperatorError('`durable` retention needs a `baselines` store, and none is set');
  }

  switch (baselines.kind) {
    case 'directory':
      return createDurableStore(baselines.root);
    case 'lfs':
      return createLfsStore({
        root: baselines.root,
        ...(baselines.pattern !== undefined ? { pattern: baselines.pattern } : {}),
      });
    case 'remote':
      return createRemoteStore({
        endpoint: baselines.endpoint,
        ...(baselines.token !== undefined ? { token: baselines.token } : {}),
      });
  }
}

/** The default artifact writer: bytes to a path, parents created. */
export async function writeArtifactToDisk(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

/**
 * Read a report this CLI (or something else) wrote.
 *
 * The version check is `readRunReport`'s, deliberately not repeated: one place
 * decides what a run report is. What is added is the coverage list, validated
 * rather than trusted, and *absent is preserved as absent* — a reader must be
 * able to tell "no subjects were skipped" from "the writer never said", because
 * only one of those supports the sentence "nothing needs review".
 */
export async function readCliRunReport(path: string): Promise<CliRunReport> {
  const raw = (await readRunReport(path)) as RunReport & {
    readonly notObserved?: unknown;
    readonly warnings?: unknown;
  };
  const { notObserved: rawNotObserved, warnings: rawWarnings, ...base } = raw;

  if (rawWarnings !== undefined && !isStringArray(rawWarnings)) {
    throw new Error(`${path} has a \`warnings\` field that is not an array of strings`);
  }
  const warnings: readonly string[] | undefined = rawWarnings;

  if (rawNotObserved === undefined) {
    return { ...base, ...(warnings !== undefined ? { warnings } : {}) };
  }

  if (!Array.isArray(rawNotObserved)) {
    throw new Error(`${path} has a \`notObserved\` field that is not an array`);
  }

  const notObserved = (rawNotObserved as readonly unknown[]).map((entry, index) => {
    const row = entry as Partial<NotObserved>;
    if (typeof row.subject !== 'string' || typeof row.because !== 'string') {
      throw new Error(`${path}: notObserved[${index}] has no \`subject\` and \`because\``);
    }
    if (row.kind !== 'excluded' && row.kind !== 'failed') {
      // Not defaulted. Guessing `excluded` would turn a coverage hole into a
      // decision somebody made, and guessing `failed` would turn every deliberate
      // exclusion into a permanently red build.
      throw new Error(
        `${path}: notObserved[${index}].kind is ${JSON.stringify(row.kind)}, ` +
          'which is neither "excluded" nor "failed"',
      );
    }
    return { subject: row.subject, kind: row.kind, because: row.because };
  });

  return { ...base, notObserved, ...(warnings !== undefined ? { warnings } : {}) };
}

/** The default report writer. Shares `writeRunReport`'s on-disk shape by using it. */
export async function writeCliRunReport(path: string, report: CliRunReport): Promise<void> {
  await writeRunReport(path, report);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function describeIdentity(identity: RenderIdentity): string {
  return `${identity.renderer} (${identity.engine}, ${identity.platform}, ${identity.deviceScaleFactor}x)`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
