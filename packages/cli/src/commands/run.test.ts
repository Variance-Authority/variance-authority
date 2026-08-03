import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  documentDigest,
  environmentKey,
  profileById,
  type Diagnostic,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
  type SemanticSnapshot,
  type Viewport,
} from '@variance-authority/core';
import type { Observation } from '@variance-authority/observe';
import {
  RasterStoreError,
  createEphemeralStore,
  type Found,
  type RasterStore,
  type Renderer,
} from '@variance-authority/raster';
import type { Config } from '../config.js';
import { EXIT_CLEAN, EXIT_REVIEW, OperatorError, exitFor } from '../exit.js';
import {
  matchesGlob,
  readCliRunReport,
  recordOf,
  run,
  settle,
  storeFor,
  type CliRunReport,
  type Collected,
  type Collector,
  type Plan,
  type PlannedSubject,
} from './run.js';

const VIEWPORT: Viewport = {
  width: 1280,
  height: 800,
  deviceScaleFactor: 2,
  colorScheme: 'light',
};

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  // 1 here, as a real renderer reports it: the document's viewport supplies the
  // scale a raster is actually painted at. Exercising the gap on purpose.
  deviceScaleFactor: 1,
  fonts: [],
};

const OTHER_MACHINE: RenderIdentity = { ...IDENTITY, platform: 'darwin/arm64' };

/**
 * A design system served from a cross-origin `<link>`, at the severity that gates.
 *
 * `collector-dom` emits this code at `warn` today; `error` is used here because
 * the severity is what `exitFor` reads, and the CLI's half of that contract has to
 * be pinned independently of which severity any one collector chooses.
 */
const UNREADABLE: Diagnostic = {
  severity: 'error',
  code: 'unreadable-stylesheet',
  message: 'stylesheet "https://cdn.example/tokens.css" is cross-origin; its rules were not collected',
};

const DANGLING: Diagnostic = {
  severity: 'warn',
  code: 'dangling-id-reference',
  message: 'reference to id "label" resolves outside the subject subtree',
};

function documentFor(id: string, html = '<div data-va-path="0">x</div>'): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id, kind: 'fixture' },
    html,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

/** The same document, with the collector's complaints attached to it. */
function documentWith(id: string, diagnostics: readonly Diagnostic[]): RenderDocument {
  return { ...documentFor(id), diagnostics };
}

/** A snapshot carrying diagnostics, and otherwise the emptiest one that type-checks. */
function snapshotWith(id: string, diagnostics: readonly Diagnostic[]): SemanticSnapshot {
  return {
    formatVersion: 1,
    subject: { id, kind: 'fixture' },
    profile: profileById('chromium'),
    environment: environmentKey({
      profile: 'chromium',
      engine: 'chromium@131',
      ruleset: 'test',
      allowlist: 'test',
      viewport: VIEWPORT,
      fonts: [],
      conditions: {},
      assets: {},
    }),
    renderHash: 'v1:0',
    structureHash: 'v1:0',
    styleHash: 'v1:0',
    root: { path: '0', tag: 'div', attributes: {}, style: {}, children: [] },
    styleProvenance: [],
    diagnostics,
  };
}

function rasterFor(document: RenderDocument, identity: RenderIdentity): Raster {
  return {
    documentDigest: documentDigest(document),
    identity: { ...identity, deviceScaleFactor: document.viewport.deviceScaleFactor },
    width: 100,
    height: 40,
    bytes: Buffer.from('not a real png').toString('base64'),
    missingFonts: [],
  };
}

function fakeRenderer(identity: RenderIdentity = IDENTITY): Renderer {
  return {
    identity,
    identityFor(document) {
      return { ...identity, deviceScaleFactor: document.viewport.deviceScaleFactor };
    },
    async render(document) {
      return rasterFor(document, identity);
    },
    async close() {
      /* nothing to release */
    },
  };
}

/**
 * An ephemeral store — a real cache — with the baseline lookups answering
 * whatever a test needs.
 *
 * `describe` is derived from the same `found` rather than inherited from the
 * ephemeral base, because a store whose two lookups disagree is not a store. The
 * run reads the cheap one to settle and the expensive one only to write a diff
 * image, so a fake answering `null` to the first would send every test here down
 * the render path no matter what it set up — passing for the wrong reason, which
 * is the failure mode a fake is most likely to introduce.
 */
function storeAnswering(found: Found | null | (() => never)): RasterStore {
  const base = createEphemeralStore();
  const answer = (): Found | null => {
    if (typeof found === 'function') found();
    return found as Found | null;
  };

  return {
    ...base,
    async find() {
      return answer();
    },
    async describe() {
      const baseline = answer();
      if (baseline === null) return null;
      return {
        documentDigest: baseline.raster.documentDigest,
        comparable: baseline.comparable,
        storedUnder: baseline.storedUnder,
        missingFonts: baseline.raster.missingFonts,
      };
    },
  };
}

function collectorOf(plan: Plan, collect: (subject: PlannedSubject) => Collected): Collector {
  return {
    async plan() {
      return plan;
    },
    async collect(subject) {
      return collect(subject);
    },
    async close() {
      /* nothing to release */
    },
  };
}

function configOf(overrides: Partial<Config> = {}): Config {
  return {
    project: 'test',
    profile: 'chromium',
    viewport: VIEWPORT,
    retention: 'durable',
    subjects: { kind: 'list', ids: ['fixture:a'], collector: '/repo/collector.mjs' },
    baselines: { kind: 'directory', root: '/repo/baselines' },
    fonts: [],
    report: '/repo/out/report.json',
    images: '/repo/out/images',
    ...overrides,
  };
}

interface Written {
  readonly artifacts: Map<string, Buffer>;
  reports: CliRunReport[];
}

async function runWith(
  config: Config,
  collector: Collector,
  store: RasterStore,
  options: { subjects?: string; intent?: string; renderer?: Renderer } = {},
): Promise<{ report: CliRunReport; written: Written }> {
  const written: Written = { artifacts: new Map(), reports: [] };

  const report = await run({
    config,
    ...(options.subjects !== undefined ? { subjects: options.subjects } : {}),
    ...(options.intent !== undefined ? { intent: options.intent } : {}),
    deps: {
      collector,
      store,
      renderer: async () => options.renderer ?? fakeRenderer(),
      now: () => '2026-08-01T00:00:00.000Z',
      writeArtifact: async (path, bytes) => {
        written.artifacts.set(path, bytes);
      },
      writeReport: async (_path, value) => {
        written.reports.push(value);
      },
    },
  });

  return { report, written };
}

describe('settle', () => {
  const document = documentFor('fixture:a');
  const digest = documentDigest(document);

  it('settles `unchanged` when the baseline was painted from this exact document', () => {
    // The economy the whole command rests on: a render document states everything
    // sent to a renderer, so an identical one under an identical identity cannot
    // produce a different image. No browser is asked.
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: true,
      storedUnder: IDENTITY,
      missingFonts: [],
    };

    expect(settle(digest, found)).toEqual({
      kind: 'settled',
      verdict: 'unchanged',
      because: expect.stringContaining('byte-identical'),
    });
  });

  it('refuses to render against a baseline another machine painted', () => {
    // Rendering here would buy a large, confident diff caused by a font stack or
    // a driver, which the report would then blame on a component.
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: false,
      storedUnder: OTHER_MACHINE,
      missingFonts: [],
    };

    const settlement = settle(digest, found);
    expect(settlement.kind).toBe('settled');
    expect(settlement).toMatchObject({ verdict: 'incomparable' });
    expect(settlement.because).toContain('darwin/arm64');
  });

  it('keeps the fonts the baseline was painted without when the digest settles it', () => {
    // The digest is sound about pixels and says nothing about fonts. A baseline
    // painted while the renderer lacked Inter is an image of a substituted font,
    // and answering a repeat of that document with a bare `unchanged` drops a fact
    // the baseline itself recorded — the reader is then told the subject is fine
    // by a comparison that never mentioned it is looking at the wrong typeface.
    const found: Described = {
      documentDigest: documentDigest(document),
      comparable: true,
      storedUnder: IDENTITY,
      missingFonts: ['Inter'],
    };

    const settlement = settle(digest, found);
    expect(settlement).toMatchObject({ kind: 'settled', missingFonts: ['Inter'] });
    expect(settlement.because).toContain('substituted font');
  });

  it('renders when the document moved', () => {
    const found: Described = {
      documentDigest: documentDigest(documentFor('fixture:a', '<div data-va-path="0">y</div>')),
      comparable: true,
      storedUnder: IDENTITY,
      missingFonts: [],
    };
    expect(settle(digest, found).kind).toBe('render');
  });

  it('renders when there is no baseline, so the subject can be accepted at all', () => {
    // The verdict `new` needs no image; `accept` does, and `accept` may never
    // re-render. This is the one render this function knowingly pays for.
    expect(settle(digest, null)).toEqual({
      kind: 'render',
      because: expect.stringContaining('no baseline'),
    });
  });
});

describe('matchesGlob', () => {
  it('matches `*` across any characters, including a colon', () => {
    // Subject ids are namespaced identifiers, not paths. A path-aware glob would
    // stop at a separator that carries no meaning here.
    expect(matchesGlob('story:*', 'story:components-button--primary')).toBe(true);
    expect(matchesGlob('*button*', 'story:components-button--primary')).toBe(true);
    expect(matchesGlob('story:*', 'fixture:button')).toBe(false);
  });

  it('anchors the whole id rather than matching a substring', () => {
    expect(matchesGlob('button', 'story:button')).toBe(false);
  });

  it('treats regex metacharacters in the pattern as literals', () => {
    // `story:a.b` must not match `story:axb`; a pattern is a glob, not a regex.
    expect(matchesGlob('story:a.b', 'story:axb')).toBe(false);
    expect(matchesGlob('story:a.b', 'story:a.b')).toBe(true);
  });
});

describe('recordOf', () => {
  const base: Observation = {
    subject: 'fixture:a',
    verdict: 'changed',
    because: '1000 pixel(s) differ across 2 region(s)',
    comparison: {
      width: 100,
      height: 40,
      dimensionsChanged: false,
      before: { width: 100, height: 40 },
      after: { width: 100, height: 40 },
      changed: { default: 1000, strict: 1200 },
      total: 4000,
      mask: { width: 100, height: 40, data: new Uint8Array(0), changed: 1000 },
    },
    isolation: { regions: [], truncated: 3, truncatedPixels: 42 },
    regions: [
      {
        region: { x: 0, y: 0, width: 40, height: 40, pixels: 900, density: 0.5 },
        path: '0/1',
        component: 'Stack',
        where: 'main',
        unattributed: false,
      },
      {
        region: { x: 50, y: 0, width: 10, height: 10, pixels: 100, density: 1 },
        path: '0/2',
        component: 'Toggle',
        where: 'main → toggle',
        unattributed: false,
      },
    ],
    rendered: true,
    missingFonts: ['Inter'],
  };

  it('ranks the named cause above the larger region it displaced', () => {
    // Area measures displacement, not cause: an edit reflows far more of its
    // surroundings than of itself, so `Stack` outranks `Toggle` on pixels alone.
    const record = recordOf(base, { causes: ['Toggle'] });

    expect(record.regions.map((region) => region.component)).toEqual(['Toggle', 'Stack']);
    expect(record.regions[0]?.cause).toBe(true);
  });

  it('reports the truncated tail rather than presenting a capped list as complete', () => {
    expect(recordOf(base).truncated).toEqual({ regions: 3, pixels: 42 });
  });

  it('carries missing fonts through, because the images are of a substituted font', () => {
    expect(recordOf(base).missingFonts).toEqual(['Inter']);
  });

  it('carries the collector’s diagnostics onto the record and into its sentence', () => {
    // A diagnostic that stops at `RenderDocument` is a fact nobody can act on. The
    // record is the whole contract with the report, the MCP tools and the exit
    // code, so a subject observed from a document the collector could not fully
    // read has to say so where all three of them look.
    const record = recordOf(base, { diagnostics: [UNREADABLE] });

    expect(record.diagnostics).toEqual([UNREADABLE]);
    expect(record.because).toContain('unreadable-stylesheet');
  });

  it('states the pixels the default policy forgave when the verdict is `unchanged`', () => {
    // "Zero pixels changed" after antialiasing forgiveness is a different claim
    // from "the images are identical", and quoting only the forgiving policy is
    // the most common way to lie with a pixel measurement.
    const unchanged: Observation = {
      ...base,
      verdict: 'unchanged',
      because: 'no pixels differ',
      comparison: { ...base.comparison!, changed: { default: 0, strict: 37 } },
      regions: [],
    };

    expect(recordOf(unchanged).because).toContain('37 pixel(s) do differ under the strict policy');
  });

  it('never turns a nearest node into an attribution', () => {
    // `nearest` answers "what is this near", which is a different claim from
    // "this is what changed". Writing it into `component` would make a trace tool
    // count an appearance no box actually contained.
    const unattributed: Observation = {
      ...base,
      regions: [
        {
          region: { x: 0, y: 0, width: 4, height: 4, pixels: 9, density: 1 },
          unattributed: true,
          nearest: { path: '0/1', component: 'Card', where: 'main → card' },
        },
      ],
    };

    const region = recordOf(unattributed).regions[0];
    expect(region?.component).toBeUndefined();
    expect(region?.unattributed).toBe(true);
    expect(region?.where).toBe('near Card (main → card)');
  });
});

describe('run', () => {
  const plan: Plan = {
    subjects: [
      { subject: { id: 'fixture:a', kind: 'fixture' } },
      { subject: { id: 'fixture:b', kind: 'fixture' } },
    ],
    notObserved: [{ subject: 'fixture:x', kind: 'excluded', because: 'tagged `!test`' }],
    warnings: ['the index declared 1 entry this adapter does not understand'],
  };

  const collectsBoth = collectorOf(plan, (subject) => ({
    ok: true,
    document: documentFor(subject.subject.id),
  }));

  it('settles unchanged subjects without asking the renderer for an image', async () => {
    // The measurable claim: 300 subjects, 0 renders *and 0 image reads* when
    // nothing moved.
    let renders = 0;
    let images = 0;
    const renderer: Renderer = {
      identity: IDENTITY,
      identityFor(document) {
        return { ...IDENTITY, deviceScaleFactor: document.viewport.deviceScaleFactor };
      },
      async render(document) {
        renders += 1;
        return rasterFor(document, IDENTITY);
      },
      async close() {
        /* nothing */
      },
    };

    const found = (id: string): Found => ({
      raster: rasterFor(documentFor(id), IDENTITY),
      comparable: true,
      storedUnder: IDENTITY,
    });

    const store: RasterStore = {
      ...createEphemeralStore(),
      async find(key) {
        images += 1;
        return found(key.subject);
      },
      async describe(key) {
        return {
          documentDigest: documentDigest(documentFor(key.subject)),
          comparable: true,
          storedUnder: IDENTITY,
          missingFonts: [],
        };
      },
    };

    const { report } = await runWith(configOf(), collectsBoth, store, { renderer });

    expect(renders).toBe(0);
    // And no image was *read* either, which is the half of the claim that used
    // not to hold: the settled path went through `find`, so a suite where
    // nothing moved still moved every baseline PNG in order to compare 32 hex
    // characters. `describe` answers from the sidecar, so a fully-settled run
    // now touches no image on either side.
    expect(images).toBe(0);
    expect(report.observations.map((entry) => entry.verdict)).toEqual([
      'unchanged',
      'unchanged',
    ]);
  });

  it('carries the plan’s own exclusions into the report', async () => {
    // A subject that vanishes without a word is indistinguishable from one that
    // passed. The adapter's reason has to reach the artifact, not a log line.
    const { report } = await runWith(configOf(), collectsBoth, storeAnswering(null));

    expect(report.notObserved).toContainEqual({
      subject: 'fixture:x',
      kind: 'excluded',
      because: 'tagged `!test`',
    });
  });

  it('lists a subject the glob filtered out, rather than dropping it', async () => {
    const { report } = await runWith(configOf(), collectsBoth, storeAnswering(null), {
      subjects: 'fixture:a',
    });

    expect(report.observations).toHaveLength(1);
    expect(report.notObserved).toContainEqual({
      subject: 'fixture:b',
      kind: 'excluded',
      because: 'did not match --subjects fixture:a',
    });
  });

  it('records a collector failure as `failed`, and keeps observing the rest', async () => {
    // One component that throws must not cost the other 299 their observations,
    // and must not be silently absent from the report either.
    const collector = collectorOf(plan, (subject): Collected =>
      subject.subject.id === 'fixture:a'
        ? { ok: false, because: 'the story never became ready within 15000ms' }
        : { ok: true, document: documentFor(subject.subject.id) },
    );

    const { report } = await runWith(configOf(), collector, storeAnswering(null));

    expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:b']);
    expect(report.notObserved).toContainEqual({
      subject: 'fixture:a',
      kind: 'failed',
      because: 'the story never became ready within 15000ms',
    });
  });

  it('reports an ephemeral subject with no previous document as failed, not as passing', async () => {
    // Ephemeral retention renders both sides now. With only one side there is no
    // comparison, and an unobservable difference is never no difference.
    const { baselines, ...durable } = configOf();
    void baselines;
    const config: Config = { ...durable, retention: 'ephemeral' };

    const { report } = await runWith(config, collectsBoth, createEphemeralStore());

    expect(report.observations).toHaveLength(0);
    expect(report.notObserved).toContainEqual({
      subject: 'fixture:a',
      kind: 'failed',
      because: expect.stringContaining('no previous-revision document'),
    });
  });

  it('turns a baseline-store failure into an operator error, never into a verdict', async () => {
    // Spec 0004: an unreachable endpoint reported as `new` would make the next
    // `accept` overwrite the only copy of what the subject looked like before.
    const store = storeAnswering(() => {
      throw new RasterStoreError('store http://box:7788 could not be reached');
    });

    await expect(runWith(configOf(), collectsBoth, store)).rejects.toBeInstanceOf(OperatorError);
  });

  it('writes the report to the configured path and returns the same value', async () => {
    const { report, written } = await runWith(configOf(), collectsBoth, storeAnswering(null));
    expect(written.reports).toEqual([report]);
  });

  it('leaves the candidate image and its sidecar beside the report', async () => {
    // `accept` promotes an image the run produced and never renders one, so the
    // bytes and the identity that painted them both have to survive the run.
    const { written } = await runWith(configOf(), collectsBoth, storeAnswering(null));

    expect([...written.artifacts.keys()]).toContain('/repo/out/images/fixture%3Aa.after.png');
    expect([...written.artifacts.keys()]).toContain('/repo/out/images/fixture%3Aa.after.json');

    const sidecar = JSON.parse(
      written.artifacts.get('/repo/out/images/fixture%3Aa.after.json')!.toString('utf8'),
    ) as { documentDigest: string; identity: RenderIdentity };
    expect(sidecar.documentDigest).toBe(documentDigest(documentFor('fixture:a')));
    expect(sidecar.identity.deviceScaleFactor).toBe(2);
  });

  const onlyA: Plan = {
    subjects: [{ subject: { id: 'fixture:a', kind: 'fixture' } }],
    notObserved: [],
    warnings: [],
  };

  /**
   * A store holding the baseline this document was painted from: the settled path.
   *
   * `describe` is the one the run actually reaches here — settling reads the
   * sidecar and never the image — and `find` is kept in agreement so a test that
   * moves off this path finds a coherent store rather than an empty one.
   */
  function settlingStore(missingFonts: readonly string[] = []): RasterStore {
    return {
      ...createEphemeralStore(),
      async find(key) {
        return {
          raster: { ...rasterFor(documentFor(key.subject), IDENTITY), missingFonts },
          comparable: true,
          storedUnder: IDENTITY,
        };
      },
      async describe(key) {
        return {
          documentDigest: documentDigest(documentFor(key.subject)),
          comparable: true,
          storedUnder: IDENTITY,
          missingFonts,
        };
      },
    };
  }

  it('carries the collector’s diagnostics to the verdict instead of dropping them', async () => {
    // The missed detection this closes: a subject whose design system is served
    // from a cross-origin `<link>` is collected without those rules, compared
    // against a baseline collected the same way, and reports `unchanged` — the
    // pixels really do match, because both sides are missing the same styling.
    // Nothing in the verdict can see that, so the diagnostic has to reach the
    // record and the exit code, from the settled path as much as the rendered one.
    const collector = collectorOf(onlyA, (subject) => ({
      ok: true,
      document: documentWith(subject.subject.id, [UNREADABLE]),
      snapshot: snapshotWith(subject.subject.id, [DANGLING]),
    }));

    const { report } = await runWith(configOf(), collector, settlingStore());

    expect(report.observations[0]?.verdict).toBe('unchanged');
    expect(report.observations[0]?.diagnostics).toEqual([UNREADABLE, DANGLING]);
    expect(exitFor(report)).toBe(EXIT_REVIEW);
  });

  it('does not hold a run open for a warn, which states a limit rather than a hole', async () => {
    // The counterweight to the test above: `unverified-fonts` and its kind fire on
    // every subject of a suite that supplied no font hashes, and gating on them
    // would make that suite permanently red — which ends with the gate switched
    // off. Recorded, not gated.
    const collector = collectorOf(onlyA, (subject) => ({
      ok: true,
      document: documentWith(subject.subject.id, [DANGLING]),
    }));

    const { report } = await runWith(configOf(), collector, settlingStore());

    expect(report.observations[0]?.diagnostics).toEqual([DANGLING]);
    expect(exitFor(report)).toBe(EXIT_CLEAN);
  });

  it('records the fonts the baseline was painted without on a digest-settled subject', async () => {
    // The digest short-circuit is sound about pixels and is not entitled to drop a
    // fact the baseline already recorded: a bare `unchanged` about a substituted
    // font tells the reader the subject is fine, in a sentence produced by a
    // comparison that never looked at the typeface.
    const collector = collectorOf(onlyA, (subject) => ({
      ok: true,
      document: documentFor(subject.subject.id),
    }));

    const { report } = await runWith(configOf(), collector, settlingStore(['Inter']));

    expect(report.observations[0]).toMatchObject({
      verdict: 'unchanged',
      missingFonts: ['Inter'],
    });
    expect(report.observations[0]?.because).toContain('substituted font');
  });

  it('states in the report that a profile without layout cannot attribute regions', async () => {
    // Otherwise the limit is discovered from a report full of coordinates with no
    // names, and read as the tool failing rather than as the profile's declared
    // blindness (ADR-0002).
    const { report } = await runWith(
      configOf({ profile: 'jsdom' }),
      collectsBoth,
      storeAnswering(null),
    );

    expect(report.warnings?.join('\n')).toContain('no layout engine');
  });
});

describe('readCliRunReport', () => {
  it('refuses a diagnostic whose severity is neither warn nor error', async () => {
    // The exit code now rests on this field, and a report is a file people edit by
    // hand while triaging. Reading an unknown severity as `warn` would let a hole
    // in the coverage exit 0; reading it as `error` would hold every run open on a
    // typo. Neither guess is available.
    const directory = await mkdtemp(join(tmpdir(), 'variance-cli-'));
    const path = join(directory, 'report.json');

    await writeFile(
      path,
      JSON.stringify({
        runVersion: 1,
        at: '2026-08-01T00:00:00.000Z',
        identity: IDENTITY,
        retention: 'durable',
        observations: [
          {
            subject: 'fixture:a',
            verdict: 'unchanged',
            because: 'no pixels differ',
            changedPixels: 0,
            regions: [],
            diagnostics: [{ severity: 'fatal', code: 'x', message: 'y' }],
          },
        ],
        notObserved: [],
      }),
      'utf8',
    );

    try {
      await expect(readCliRunReport(path)).rejects.toThrow(/neither "warn" nor "error"/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('storeFor', () => {
  const made: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function directory(prefix: string): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), prefix));
    made.push(path);
    return path;
  }

  it('keeps the regenerable render cache out of the LFS-tracked baseline tree', async () => {
    // The cache is keyed by document digest, so it gains an entry per edit and is
    // worth nothing after one. Under the tracked root it is committed like a
    // baseline: every run adds megabytes of PNGs to the object database that
    // nobody will ever read, and the LFS quota pays for it forever.
    const root = await directory('variance-baselines-');
    const cache = await directory('variance-cache-');
    vi.stubEnv('XDG_CACHE_HOME', cache);

    const store = await storeFor(configOf({ baselines: { kind: 'lfs', root } }));
    const raster = rasterFor(documentFor('fixture:a'), IDENTITY);
    await store.renderCache.put(raster);

    // Still a cache: pushing it out of the work tree must not cost the hit that
    // pays for the whole deferral.
    expect(await store.renderCache.get(raster.documentDigest, raster.identity)).not.toBeNull();
    // Only the tracking entry the store writes on the way in.
    expect(await readdir(root)).toEqual(['.gitattributes']);
  });
});

/**
 * The corner-cut this whole project is built on is that the world is not rebuilt
 * between subjects, and the risk it buys is that subject B renders differently
 * because subject A ran first. A comparison cannot tell that apart from a
 * regression: both arrive as "the pixels moved".
 *
 * Every case here is the *deterministic* leak, and that is the point. The
 * detection `@variance-authority/session` already implements re-runs a subject
 * in the same session and compares hashes, which varies time and holds the world
 * fixed — so a leak that happens every time never moves the hash and is reported
 * as nothing at all. These subjects would pass that check and still be wrong.
 */
describe('a change that does not survive a clean world', () => {
  const WHITE = png(255);
  const BLACK = png(0);

  /**
   * A real PNG, because the comparison decodes one and a stub does not survive
   * `PNG.sync.read`. Hand-rolled on `node:zlib` rather than on `pngjs`, which
   * would be a fourth package declaring the same requirement to write ten pixels.
   */
  function png(level: number): string {
    const raw = Buffer.alloc(10 * (1 + 10 * 4));
    for (let y = 0; y < 10; y += 1) {
      const row = y * (1 + 10 * 4);
      raw[row] = 0;
      for (let x = 0; x < 10; x += 1) {
        const at = row + 1 + x * 4;
        raw[at] = level;
        raw[at + 1] = level;
        raw[at + 2] = level;
        raw[at + 3] = 255;
      }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(10, 0);
    ihdr.writeUInt32BE(10, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]).toString('base64');
  }

  function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  }

  function crc32(bytes: Buffer): number {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
      }
    }
    return (value ^ 0xffffffff) >>> 0;
  }

  /**
   * `dark` is what a leaked stylesheet did to this subject; `plain` is the truth.
   *
   * Carried in the html rather than in a hash field, because `documentDigest`
   * covers the document's own inputs and not the snapshot's derived hashes — a
   * marker the digest cannot see settles against the baseline and never reaches
   * a comparison at all.
   */
  function documentPainted(id: string, paint: 'plain' | 'dark'): RenderDocument {
    return documentFor(id, `<div data-va-path="0" data-paint="${paint}">x</div>`);
  }

  function painter(): Renderer {
    return {
      identity: IDENTITY,
      identityFor(document) {
        return { ...IDENTITY, deviceScaleFactor: document.viewport.deviceScaleFactor };
      },
      async render(document) {
        return {
          documentDigest: documentDigest(document),
          identity: { ...IDENTITY, deviceScaleFactor: document.viewport.deviceScaleFactor },
          width: 10,
          height: 10,
          bytes: document.html.includes('data-paint="dark"') ? BLACK : WHITE,
          missingFonts: [],
        };
      },
      async close() {
        /* nothing to release */
      },
    };
  }

  /** The baseline: this subject, painted from a document nothing had polluted. */
  function baselineOf(id: string): Found {
    const clean = documentPainted(id, 'plain');
    return {
      raster: {
        documentDigest: documentDigest(clean),
        identity: { ...IDENTITY, deviceScaleFactor: VIEWPORT.deviceScaleFactor },
        width: 10,
        height: 10,
        bytes: WHITE,
        missingFonts: [],
      },
      comparable: true,
      storedUnder: IDENTITY,
    };
  }

  /**
   * A collector whose shared world is poisoned and whose clean world is not.
   *
   * `collect` returns the same polluted document every time it is asked, which is
   * exactly the failure a same-session re-run cannot see.
   */
  function leaking(
    ids: readonly string[],
    options: { alone?: 'plain' | 'dark'; shared?: 'plain' | 'dark' } = {},
  ): Collector & { aloneCalls: string[] } {
    const aloneCalls: string[] = [];
    const plan: Plan = {
      subjects: ids.map((id) => ({ subject: { id, kind: 'fixture' as const } })),
      notObserved: [],
      warnings: [],
    };

    return {
      aloneCalls,
      async plan() {
        return plan;
      },
      async collect(subject) {
        return { ok: true, document: documentPainted(subject.subject.id, options.shared ?? 'dark') };
      },
      async collectAlone(subject) {
        aloneCalls.push(subject.subject.id);
        return { ok: true, document: documentPainted(subject.subject.id, options.alone ?? 'plain') };
      },
      async close() {
        /* nothing to release */
      },
    };
  }

  it('calls it order dependence when the difference is gone with nothing else in the world', async () => {
    const collector = leaking(['fixture:a']);
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    const [observation] = report.observations;
    // The verdict stays `changed`, and that is deliberate: the pixels really did
    // move. What the second pass adds is *why*, and the two need opposite work.
    expect(observation?.verdict).toBe('changed');
    expect(observation?.alone?.reproduced).toBe(false);
    expect(observation?.alone?.because).toContain('gone when nothing else has run');
    expect(collector.aloneCalls).toEqual(['fixture:a']);
  });

  it('leaves a real change standing, because it is still there alone', async () => {
    // Same shape, one difference: the clean world shows the change too. Nothing
    // here may soften a regression — a second render that can only clear a
    // failure is a retry, and this is not one.
    const collector = leaking(['fixture:a'], { alone: 'dark' });
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.verdict).toBe('changed');
    expect(report.observations[0]?.alone?.reproduced).toBe(true);
    expect(report.observations[0]?.alone?.because).toContain('still there');
  });

  it('never re-collects a subject that did not change, so a green run pays nothing', async () => {
    const collector = leaking(['fixture:a'], { shared: 'plain' });
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.verdict).toBe('unchanged');
    expect(report.observations[0]?.alone).toBeUndefined();
    expect(collector.aloneCalls).toEqual([]);
  });

  it('says the collector has no clean world, rather than reading silence as clean', async () => {
    // A collector holding one page open across the whole run cannot produce one,
    // and the absent capability has to arrive as a sentence. Read as "it
    // reproduces", a missing method promotes every leak with a confirmation
    // attached to it.
    const collector = collectorOf(
      { subjects: [{ subject: { id: 'fixture:a', kind: 'fixture' } }], notObserved: [], warnings: [] },
      (subject) => ({ ok: true, document: documentPainted(subject.subject.id, 'dark') }),
    );

    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.alone?.reproduced).toBe(true);
    expect(report.observations[0]?.alone?.because).toContain('no `collectAlone`');
  });

  it('stops at the budget and says so, so a token change cannot buy full isolation', async () => {
    // The one case where this pass costs more than the isolation it replaces:
    // everything changed, so everything would be re-collected. The cap is the
    // answer, and a cap that is not reported reads as coverage.
    const collector = leaking(['fixture:a', 'fixture:b', 'fixture:c']);
    const store = storeAnswering(baselineOf('fixture:a'));

    const { report } = await runWith(configOf({ alone: { limit: 2 } }), collector, store, {
      renderer: painter(),
    });

    // Spent across the run rather than per subject: two re-collections, not three.
    expect(collector.aloneCalls).toEqual(['fixture:a', 'fixture:b']);
    expect(report.observations[2]?.alone?.reproduced).toBe(true);
    expect(report.observations[2]?.alone?.because).toContain('budget of 2 subjects');
  });

  it('turns the pass off at zero without claiming anything about the change', async () => {
    // `limit: 0` is a decision and an absent `collectAlone` is a missing
    // capability. Both skip the work; only one of them is worth a sentence about
    // the collector, so the operator who chose this is not told to write a method
    // they already wrote.
    const collector = leaking(['fixture:a']);
    const { report } = await runWith(configOf({ alone: { limit: 0 } }), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.verdict).toBe('changed');
    expect(report.observations[0]?.alone).toBeUndefined();
    expect(collector.aloneCalls).toEqual([]);
  });
});
