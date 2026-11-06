import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashComponents } from '@variance-authority/core/attribute';
import {
  CHROMIUM_PROFILE,
  documentDigest,
  environmentKey,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
  type SemanticNode,
  type SemanticSnapshot,
  type Viewport,
} from '@variance-authority/core/format';
import type { Renderer } from '@variance-authority/raster';
import { createDurableStore } from '@variance-authority/store/durable';
import { observeAgainstBaseline, observeRasters } from './observe.js';
import { packSnapshot } from './packed.js';
import { keptRaster } from '@variance-authority/store/keep';

/**
 * A control replaced by a larger element, decided against a stored baseline.
 *
 * The region a replacement changes is the union of what left and what
 * arrived, so only the baseline's own tree can say where the control was. It
 * rides in the sidecar, packed; a baseline written before it did has none, and
 * the verdict says so rather than joining against one render in silence.
 *
 * The baseline goes through a durable store, so what is decided is what the
 * sidecar kept rather than the object this file built.
 */

const MACHINE: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

const VIEWPORT: Viewport = { width: 40, height: 40, deviceScaleFactor: 1, colorScheme: 'light' };

/** 40×40, white, with black over each rect given. */
function image(...squares: { x: number; y: number; width: number; height: number }[]): string {
  const png = new PNG({ width: 40, height: 40 });
  png.data.fill(0xff);
  for (const square of squares) {
    for (let y = square.y; y < square.y + square.height; y += 1) {
      for (let x = square.x; x < square.x + square.width; x += 1) {
        const index = (y * 40 + x) * 4;
        png.data[index] = 0;
        png.data[index + 1] = 0;
        png.data[index + 2] = 0;
      }
    }
  }
  return PNG.sync.write(png).toString('base64');
}

const ROW = { owners: [{ name: 'Row', propsDigest: 'v1:a' }], createdBy: 'Row' };
const TOGGLE = { owners: [{ name: 'Row', propsDigest: 'v1:a' }], createdBy: 'Toggle' };

/**
 * The checkbox left from (14,12) 12×12, and a 14×14 box arrived at (8,10).
 *
 * The shape of todomvc's broken toggle: the new box is larger and further
 * left, and the old one sticks out past its right edge, so neither box holds
 * the pixels that moved.
 */
const LEFT = { x: 14, y: 12, width: 12, height: 12 };
const ARRIVED = { x: 8, y: 10, width: 14, height: 14 };

function snapshotWith(toggle: typeof LEFT, control: Partial<SemanticNode> = {}): SemanticSnapshot {
  const child: SemanticNode = {
    path: '0/0',
    tag: 'div',
    attributes: {},
    style: {},
    rect: toggle,
    children: [],
    provenance: TOGGLE,
    ...control,
  };
  return {
    formatVersion: 1,
    subject: { id: 's', kind: 'fixture' },
    profile: CHROMIUM_PROFILE,
    environment: environmentKey({
      profile: 'chromium',
      engine: 'chromium',
      ruleset: 'r',
      allowlist: 'a',
      viewport: VIEWPORT,
      fonts: [],
      conditions: {},
      assets: {},
    }),
    renderHash: 'v1:r',
    structureHash: 'v1:s',
    styleHash: 'v1:t',
    root: {
      path: '0',
      tag: 'div',
      attributes: {},
      style: {},
      rect: { x: 0, y: 0, width: 40, height: 40 },
      children: [child],
      provenance: ROW,
    },
    styleProvenance: [],
    diagnostics: [],
  };
}

const BEFORE = snapshotWith(LEFT, { tag: 'input', role: 'checkbox', name: 'Done' });
const AFTER = snapshotWith(ARRIVED);

const DOCUMENT: RenderDocument = {
  documentVersion: 1,
  subject: { id: 's', kind: 'fixture' },
  html: '<div data-va-path="0"></div>',
  frame: { html: {}, body: {}, ancestors: [] },
  css: [],
  viewport: VIEWPORT,
  inherited: {},
  fonts: [],
  diagnostics: [],
};

function raster(bytes: string, digest: string): Raster {
  return { documentDigest: digest, identity: MACHINE, width: 40, height: 40, bytes, missingFonts: [] };
}

const BEFORE_IMAGE = image(LEFT);
const AFTER_IMAGE = image(ARRIVED);

function rendererOf(bytes: string): Renderer {
  return {
    identity: MACHINE,
    identityFor: () => MACHINE,
    async render(document): Promise<Raster> {
      return raster(bytes, documentDigest(document));
    },
    async close() {
      /* nothing to release */
    },
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-boxes-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function againstBaseline(baseline: Raster): ReturnType<typeof observeAgainstBaseline> {
  const store = createDurableStore(root);
  await store.put({ subject: 's' }, await keptRaster(baseline));
  return await observeAgainstBaseline(DOCUMENT, { subject: 's' }, {
    renderer: rendererOf(AFTER_IMAGE),
    store,
    snapshot: AFTER,
  });
}

describe('a stored baseline and the snapshot it kept', () => {
  it('names the replaced control when the baseline kept its snapshot', async () => {
    const observation = await againstBaseline({
      ...raster(BEFORE_IMAGE, 'v1:before'),
      components: hashComponents(BEFORE),
      snapshot: packSnapshot(BEFORE),
    });

    expect(observation.verdict).toBe('changed');
    expect(observation.regions.length).toBeGreaterThan(0);
    expect(observation.regions.every((region) => region.component === 'Toggle')).toBe(true);
    expect(observation.because).not.toContain('records no snapshot');
  });

  it('says the baseline kept no snapshot, and how to record one', async () => {
    // A baseline written before sidecars kept the tree. The change is still
    // attributed, against this render's boxes alone, and the sentence says so
    // rather than leaving the row it names to look like the answer.
    const observation = await againstBaseline({
      ...raster(BEFORE_IMAGE, 'v1:before'),
      components: hashComponents(BEFORE),
    });

    expect(observation.verdict).toBe('changed');
    expect(observation.regions.map((region) => region.component)).toContain('Row');
    expect(observation.because).toMatch(
      /; the baseline records no snapshot of its nodes, so regions were joined against this render's boxes alone: an accepting run records one on a revision where this subject is unchanged$/,
    );
  });

  it('says the same of a snapshot that will not unpack', async () => {
    const observation = await againstBaseline({ ...raster(BEFORE_IMAGE, 'v1:before'), snapshot: 'v1:not gzip' });

    expect(observation.because).toContain('the baseline records no snapshot of its nodes');
  });
});

describe('an unchanged baseline that kept no snapshot', () => {
  // Nothing changed, so nothing was joined and no sentence complains. The
  // baseline still cannot say where its nodes were the day something does, and
  // an accepting run re-stamps it on this mark, as it re-stamps one painted
  // under another identity.
  it('is marked, so an accepting run records one', async () => {
    const observation = await againstBaseline(raster(AFTER_IMAGE, 'v1:before'));

    expect(observation.verdict).toBe('unchanged');
    expect(observation.signals?.snapshot).toBe('unrecorded');
  });

  // A digest-matched one is rendered on every run until an accepting run, so
  // the sentence says why, and what ends it.
  it('says so, and what records one', async () => {
    const observation = await againstBaseline(raster(AFTER_IMAGE, 'v1:before'));

    expect(observation.because).toMatch(
      /^no pixels differ.*; the baseline records no snapshot of its nodes, and an accepting run records this one$/,
    );
  });

  it('is marked when its snapshot will not unpack', async () => {
    const observation = await againstBaseline({ ...raster(AFTER_IMAGE, 'v1:before'), snapshot: 'v1:not gzip' });

    expect(observation.signals?.snapshot).toBe('unrecorded');
  });

  it('is not marked when it kept one', async () => {
    const observation = await againstBaseline({ ...raster(AFTER_IMAGE, 'v1:before'), snapshot: packSnapshot(AFTER) });

    expect(observation.verdict).toBe('unchanged');
    expect(observation.signals).not.toHaveProperty('snapshot');
  });

  it('is not marked when this run collected none to record', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 's' }, await keptRaster(raster(AFTER_IMAGE, 'v1:before')));
    const observation = await observeAgainstBaseline(DOCUMENT, { subject: 's' }, {
      renderer: rendererOf(AFTER_IMAGE),
      store,
    });

    expect(observation.verdict).toBe('unchanged');
    expect(observation.signals).not.toHaveProperty('snapshot');
  });
});

describe('two images handed in', () => {
  it('joins against the before image when it carries its snapshot', async () => {
    const observation = await observeRasters(
      's',
      { ...raster(BEFORE_IMAGE, 'v1:before'), snapshot: packSnapshot(BEFORE) },
      raster(AFTER_IMAGE, 'v1:after'),
      { snapshot: AFTER },
    );

    expect(observation.regions.length).toBeGreaterThan(0);
    expect(observation.regions.every((region) => region.component === 'Toggle')).toBe(true);
    expect(observation.because).not.toContain('records no snapshot');
  });

  it('names the image, which no accept can rewrite', async () => {
    const observation = await observeRasters(
      's',
      raster(BEFORE_IMAGE, 'v1:before'),
      raster(AFTER_IMAGE, 'v1:after'),
      { snapshot: AFTER },
    );

    expect(observation.because).toMatch(
      /; the before image records no snapshot of its nodes, so regions were joined against the after image's boxes alone$/,
    );
  });

  it('says nothing of the join when there was no snapshot to join against', async () => {
    const observation = await observeRasters('s', raster(BEFORE_IMAGE, 'v1:before'), raster(AFTER_IMAGE, 'v1:after'));

    expect(observation.verdict).toBe('changed');
    expect(observation.because).not.toContain('records no snapshot');
  });
  it('does not mark an unchanged image as a baseline to re-stamp', async () => {
    // Nothing is stored on this side, so nothing can be re-stamped: the mark
    // would turn every unchanged pair into a promotion of a baseline that is not
    // there.
    const observation = await observeRasters(
      's',
      raster(AFTER_IMAGE, 'v1:before'),
      raster(AFTER_IMAGE, 'v1:after'),
      { snapshot: AFTER },
    );

    expect(observation.verdict).toBe('unchanged');
    expect(observation.signals).not.toHaveProperty('snapshot');
  });
});
