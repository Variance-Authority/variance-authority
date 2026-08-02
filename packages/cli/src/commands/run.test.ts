import { describe, expect, it } from 'vitest';
import {
  documentDigest,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
  type Viewport,
} from '@variance-authority/core';
import {
  RasterStoreError,
  createEphemeralStore,
  type Found,
  type Observation,
  type RasterStore,
  type Renderer,
} from '@variance-authority/raster';
import type { Config } from '../config.js';
import { OperatorError } from '../exit.js';
import {
  matchesGlob,
  recordOf,
  run,
  settle,
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
    async render(document) {
      return rasterFor(document, identity);
    },
    async close() {
      /* nothing to release */
    },
  };
}

/** An ephemeral store — a real cache — with `find` answering whatever a test needs. */
function storeAnswering(found: Found | null | (() => never)): RasterStore {
  const base = createEphemeralStore();
  return {
    ...base,
    async find() {
      if (typeof found === 'function') found();
      return found as Found | null;
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
    const found: Found = {
      raster: rasterFor(document, IDENTITY),
      comparable: true,
      storedUnder: IDENTITY,
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
    const found: Found = {
      raster: rasterFor(document, OTHER_MACHINE),
      comparable: false,
      storedUnder: OTHER_MACHINE,
    };

    const settlement = settle(digest, found);
    expect(settlement.kind).toBe('settled');
    expect(settlement).toMatchObject({ verdict: 'incomparable' });
    expect(settlement.because).toContain('darwin/arm64');
  });

  it('renders when the document moved', () => {
    const found: Found = {
      raster: rasterFor(documentFor('fixture:a', '<div data-va-path="0">y</div>'), IDENTITY),
      comparable: true,
      storedUnder: IDENTITY,
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
    // The measurable claim: 300 subjects, 0 renders when nothing moved.
    let renders = 0;
    const renderer: Renderer = {
      identity: IDENTITY,
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
        return found(key.subject);
      },
    };

    const { report } = await runWith(configOf(), collectsBoth, store, { renderer });

    expect(renders).toBe(0);
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
