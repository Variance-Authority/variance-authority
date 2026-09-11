import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { hashComponents } from '@variance-authority/core/attribute';
import {
  documentDigest,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
  type SemanticSnapshot,
  type Viewport,
} from '@variance-authority/core/format';
import {
  createEphemeralStore,
  type BaselineKey,
  type Found,
  type RasterStore,
  type Renderer,
} from '@variance-authority/raster';
import { observeAgainstBaseline } from './observe.js';

/**
 * Cause-first ranking on the durable path (spec 0017).
 *
 * The claim this closes is the one the documentation made and the binary did not
 * keep: a changed pixel resolves to the component that *caused* it rather than
 * to the component that moved. It was true of the differ and false of
 * `variance run`, for an arithmetic reason — a stored baseline is an image, an
 * image carries no document, and separating cause from collateral needs two.
 *
 * The answer is that the baseline carries the component hashes of the document
 * that painted it. These tests are about what that buys and what it costs: a
 * cause where both sides have hashes, and *no answer at all* where either side
 * does not — never a confident wrong one.
 */

const MACHINE: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

const VIEWPORT: Viewport = { width: 100, height: 60, deviceScaleFactor: 1, colorScheme: 'light' };

/**
 * A wrapper around a button, with the button's own padding as the variable.
 *
 * Hand-written rather than normalized from a capture, because `core`'s fixture
 * builders are internal to that package and exporting them would put test
 * helpers in a published surface. What matters here is the shape `hashComponents`
 * reads: an owner chain per node, a rect, and a style map.
 */
function snapshotOf(padding: string, buttonWidth: number): SemanticSnapshot {
  const owner = (name: string, outer?: string) => ({
    owners: [
      { name, propsDigest: 'v1:props' },
      ...(outer === undefined ? [] : [{ name: outer, propsDigest: 'v1:props' }]),
    ],
  });

  return {
    formatVersion: 1,
    subject: { id: 'story:page', kind: 'fixture' },
    profile: {
      id: 'chromium',
      layout: true,
      computedStyle: true,
      accessibility: 'engine',
      pseudoElements: true,
      raster: true,
    },
    environment: { inputs: {}, digest: 'v1:x', semanticDigest: 'v1:y' } as never,
    renderHash: `v1:render-${padding}`,
    structureHash: 'v1:s',
    styleHash: `v1:style-${padding}`,
    root: {
      path: '0',
      tag: 'div',
      attributes: {},
      style: { display: 'block' },
      rect: { x: 0, y: 0, width: 100, height: 60 },
      provenance: owner('Shell'),
      children: [
        {
          path: '0/0',
          tag: 'button',
          role: 'button',
          name: 'Save',
          attributes: {},
          style: { padding, color: '#000000' },
          rect: { x: 4, y: 4, width: buttonWidth, height: 20 },
          provenance: owner('Button', 'Shell'),
          text: 'Save',
          children: [],
        },
      ],
    },
    styleProvenance: [],
    diagnostics: [],
  };
}

function documentFor(id: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id, kind: 'fixture' },
    html: `<div data-va-path="0">${id}</div>`,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

function image(width: number): string {
  const png = new PNG({ width: 100, height: 60 });
  png.data.fill(0xff);
  for (let y = 4; y < 24; y += 1) {
    for (let x = 4; x < 4 + width; x += 1) {
      const index = (y * 100 + x) * 4;
      png.data[index] = 0;
      png.data[index + 1] = 0;
      png.data[index + 2] = 0;
    }
  }
  return PNG.sync.write(png).toString('base64');
}

function rasterOf(document: RenderDocument, bytes: string, snapshot?: SemanticSnapshot): Raster {
  return {
    documentDigest: documentDigest(document),
    identity: MACHINE,
    width: 100,
    height: 60,
    bytes,
    missingFonts: [],
    ...(snapshot !== undefined ? { components: hashComponents(snapshot) } : {}),
  };
}

function storeHolding(baseline: Raster): RasterStore {
  const found: Found = { raster: baseline, comparable: true, storedUnder: MACHINE };
  return {
    ...createEphemeralStore(),
    async find(_key: BaselineKey) {
      return found;
    },
  };
}

function rendererPainting(bytes: string): Renderer {
  return {
    identity: MACHINE,
    identityFor: () => MACHINE,
    async render(document) {
      return { ...rasterOf(document, bytes) };
    },
    async close() {
      /* nothing to release */
    },
  };
}

const KEY: BaselineKey = { subject: 'story:page' };

describe('a baseline that carries what its document said', () => {
  it('names the component that changed, and not the one that moved', async () => {
    const before = snapshotOf('4px', 30);
    const after = snapshotOf('8px', 46);

    const observation = await observeAgainstBaseline(documentFor('page'), KEY, {
      renderer: rendererPainting(image(46)),
      store: storeHolding(rasterOf(documentFor('page'), image(30), before)),
      snapshot: after,
    });

    expect(observation.verdict).toBe('changed');
    // `Shell` enclosed the change and its box moved. Naming it would send a
    // reviewer to a file nobody edited, which is the whole failure this closes.
    expect(observation.causes).toEqual(['Button']);
  });

  it('attributes a region to the component the hashes named', async () => {
    // The measurement behind the whole spec: area ranks the displaced above the
    // displacer, so the ordering has to come from the tier that knows why.
    const before = snapshotOf('4px', 30);
    const after = snapshotOf('8px', 46);

    const observation = await observeAgainstBaseline(documentFor('page'), KEY, {
      renderer: rendererPainting(image(46)),
      store: storeHolding(rasterOf(documentFor('page'), image(30), before)),
      snapshot: after,
    });

    const named = observation.regions.map((region) => region.component);
    expect(named).toContain('Button');
  });
});

describe('a baseline that carries nothing', () => {
  it('answers `undefined`, not an empty list', async () => {
    // The degradation, and it has to be this one. An empty list would report
    // every component as collateral — a confident wrong ordering rather than an
    // absent one — and `rankRegions` would then fall back to area *believing* it
    // had been told there were no causes.
    const observation = await observeAgainstBaseline(documentFor('page'), KEY, {
      renderer: rendererPainting(image(46)),
      store: storeHolding(rasterOf(documentFor('page'), image(30))),
      snapshot: snapshotOf('8px', 46),
    });

    expect(observation.verdict).toBe('changed');
    expect(observation.causes).toBeUndefined();
  });

  it('answers `undefined` when this run supplied no snapshot either', async () => {
    const observation = await observeAgainstBaseline(documentFor('page'), KEY, {
      renderer: rendererPainting(image(46)),
      store: storeHolding(rasterOf(documentFor('page'), image(30), snapshotOf('4px', 30))),
    });

    expect(observation.causes).toBeUndefined();
  });
});

describe('when the painted page is not the acquired page', () => {
  it('warns, naming both sizes', async () => {
    // Measured on `cases/storybook-case`: the acquired subject is 147.33 CSS
    // pixels wide and the image is 1024 at scale 1. Every region coordinate is
    // converted between those two spaces, so a report can be complete, confident
    // and about the wrong component with nothing saying so.
    const narrow: SemanticSnapshot = {
      ...snapshotOf('8px', 46),
      root: { ...snapshotOf('8px', 46).root, rect: { x: 0, y: 0, width: 40, height: 60 } },
    };

    const observation = await observeAgainstBaseline(documentFor('page'), KEY, {
      renderer: rendererPainting(image(46)),
      store: storeHolding(rasterOf(documentFor('page'), image(30))),
      snapshot: narrow,
    });

    const warning = observation.diagnostics?.find((d) => d.code === 'subject-size-diverged');
    expect(warning?.severity).toBe('warn');
    expect(warning?.message).toContain('40×60');
    expect(warning?.message).toContain('100×60');
  });

  it('is silent when the two agree, so it is not an alarm on every run', async () => {
    // The control. A warning that fires unconditionally is a warning nobody
    // reads, and `exit.ts` says why this is `warn` rather than `error`.
    const observation = await observeAgainstBaseline(documentFor('page'), KEY, {
      renderer: rendererPainting(image(46)),
      store: storeHolding(rasterOf(documentFor('page'), image(30))),
      snapshot: snapshotOf('8px', 46),
    });

    expect(observation.diagnostics).toBeUndefined();
  });

  it('says nothing when there is no rect to compare against', async () => {
    // A profile with no layout engine observed no box. ADR-0002: an unobservable
    // value is never reported as an observed one, in either direction.
    const flat = snapshotOf('8px', 46);
    const noRect: SemanticSnapshot = {
      ...flat,
      profile: { ...flat.profile, layout: false },
      root: { ...flat.root, rect: undefined },
    };

    const observation = await observeAgainstBaseline(documentFor('page'), KEY, {
      renderer: rendererPainting(image(46)),
      store: storeHolding(rasterOf(documentFor('page'), image(30))),
      snapshot: noRect,
    });

    expect(observation.diagnostics).toBeUndefined();
  });
});

describe('a warm render cache', () => {
  it('does not let a previous run’s hashes answer for this one', async () => {
    // The determinism defect ADR-0027 chose *carry over fetch* to avoid, arriving
    // one layer down. A render cache is keyed by document digest, and component
    // hashes come from the snapshot, which carries provenance the document does
    // not — so renaming a component moves the hashes while the digest holds. A
    // cache entry that kept the old ones would make the answer depend on whether
    // this machine had rendered before.
    const base = createEphemeralStore();
    const document = documentFor('page');

    // Warm the cache with a raster carrying hashes from a *different* snapshot —
    // the state a rename produces, since the document digest does not move.
    await base.renderCache.put({
      ...rasterOf(document, image(46), snapshotOf('4px', 30)),
      identity: MACHINE,
    });

    const store: RasterStore = {
      ...base,
      async find() {
        return {
          raster: rasterOf(documentFor('page'), image(30), snapshotOf('4px', 30)),
          comparable: true,
          storedUnder: MACHINE,
        };
      },
    };

    const observation = await observeAgainstBaseline(document, KEY, {
      renderer: rendererPainting(image(46)),
      store,
      snapshot: snapshotOf('8px', 46),
    });

    // The baseline and the cache agree with each other and disagree with this
    // run. Reading the cache would say nothing caused the change; reading this
    // run's snapshot says `Button` did.
    expect(observation.causes).toEqual(['Button']);
  });

  it('carries no hashes at all when this run supplied no snapshot', async () => {
    // The other half, and the one that was actually producing different answers:
    // a run with no snapshot used to inherit whatever a previous run had left in
    // the cache, so it reported causes on a warm machine and none on a cold one.
    const store = createEphemeralStore();
    const document = documentFor('page');

    await store.renderCache.put(rasterOf(document, image(46), snapshotOf('4px', 30)));

    const observation = await observeAgainstBaseline(document, KEY, {
      renderer: rendererPainting(image(46)),
      store: {
        ...store,
        async find() {
          return { raster: rasterOf(documentFor('page'), image(30), snapshotOf('4px', 30)), comparable: true, storedUnder: MACHINE };
        },
      },
    });

    expect(observation.causes).toBeUndefined();
  });
});

describe('what the run leaves for the next one', () => {
  it('keeps component hashes out of the render cache, which holds images', async () => {
    // The cache is keyed by document digest and the hashes come from a snapshot,
    // so one key can legitimately mean two sets. `images.ts` builds the candidate
    // sidecar out of this cache, so a set stored here would reach `accept` and
    // become a baseline whose hashes belong to a document it is not an image of.
    const store = createEphemeralStore();
    const document = documentFor('page');

    await observeAgainstBaseline(document, KEY, {
      renderer: rendererPainting(image(46)),
      store,
      snapshot: snapshotOf('8px', 46),
    });

    const cached = await store.renderCache.get(documentDigest(document), MACHINE);
    expect(cached).not.toBeNull();
    expect(cached?.components).toBeUndefined();
  });
});

describe('what the cause list drops, and the band record keeps', () => {
  it('reports the enclosure that only moved, and does not call it a cause', async () => {
    // `causes` is a ranking input, so it is deliberately just the names that
    // caused something. A reviewer reading *why did this reflow* needs the other
    // half — and the run has always had it, one band at a time, and threw it
    // away at this boundary.
    // The shell is a wrapper: it holds a taller button and so it is taller, and
    // nobody touched its file.
    const grown = (padding: string, width: number, height: number): SemanticSnapshot => {
      const snapshot = snapshotOf(padding, width);
      return { ...snapshot, root: { ...snapshot.root, rect: { x: 0, y: 0, width: 100, height } } };
    };

    const observation = await observeAgainstBaseline(documentFor('page'), KEY, {
      renderer: rendererPainting(image(46)),
      store: storeHolding(rasterOf(documentFor('page'), image(30), grown('4px', 30, 60))),
      snapshot: grown('8px', 46, 72),
    });

    // The delta beside the band, which is what makes the record readable: the
    // button gained sixteen pixels of padding and the shell gained twelve of
    // height because it holds one — a wrapper's growth is its child's, and both
    // sentences are on the row without a reviewer measuring anything.
    expect(observation.moved).toEqual([
      {
        component: 'Button',
        bands: ['geometry', 'token'],
        cause: true,
        grew: { width: 16, height: 0 },
      },
      { component: 'Shell', bands: ['geometry'], cause: false, grew: { width: 0, height: 12 } },
    ]);
    // And the ranking input it is a superset of still holds only the one name.
    expect(observation.causes).toEqual(['Button']);
  });

  it('is absent under exactly the condition `causes` is absent under', async () => {
    // The two travel together or a surface has to reason about four states. An
    // empty list here would say *both revisions were read and nothing moved*
    // about a comparison that read one.
    const observation = await observeAgainstBaseline(documentFor('page'), KEY, {
      renderer: rendererPainting(image(46)),
      store: storeHolding(rasterOf(documentFor('page'), image(30))),
      snapshot: snapshotOf('8px', 46),
    });

    expect(observation.causes).toBeUndefined();
    expect(observation.moved).toBeUndefined();
  });
});
