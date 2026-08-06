import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  documentDigest,
  hashComponents,
  identityDigest,
  type Level,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
  type SemanticSnapshot,
  type Viewport,
} from '@variance-authority/core';
import {
  neverFails,
  type BaselineKey,
  type Described,
  type Found,
  type RasterStore,
  type Renderer,
} from '@variance-authority/raster';
import { observeAgainstBaseline } from './observe.js';

/**
 * Route-level visual regression: assert that the page assembles, ignore the paint.
 *
 * The case the whole band vocabulary was built for and that nothing could reach
 * until now. A component's test asserts on everything — a colour token moved and
 * that *is* the change. A route's test asserts the nav is where it was and the
 * sidebar did not collapse, and a rebrand landing in forty routes is noise it
 * should never have been shown. Run one policy over both and one of them is
 * useless.
 *
 * `applySensitivity` has folded over deltas since it was written, and
 * `variance run` has never had two documents to fold over — it compares an image
 * against a stored baseline. What it *does* have, since ADR-0027, is the
 * baseline's per-component hashes, and since the band split those name a band
 * each. So the question "which bands moved" is answerable from a sidecar, and
 * that is what these tests exercise.
 *
 * Every image is built pixel by pixel because the claim is arithmetic, and the
 * pixels are always *the same difference* — what changes between the cases is
 * only what the two documents said about themselves. That is the point: two runs
 * with identical pixel evidence get opposite verdicts, decided entirely by which
 * band the documents disagree on.
 */

const MACHINE: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

const VIEWPORT: Viewport = { width: 60, height: 60, deviceScaleFactor: 1, colorScheme: 'light' };

/** 60×60, white, with an optional black square. */
function image(square: { x: number; y: number; size: number } | null): string {
  const png = new PNG({ width: 60, height: 60 });
  png.data.fill(0xff);

  if (square !== null) {
    for (let y = square.y; y < square.y + square.size; y += 1) {
      for (let x = square.x; x < square.x + square.size; x += 1) {
        const index = (y * 60 + x) * 4;
        png.data[index] = 0;
        png.data[index + 1] = 0;
        png.data[index + 2] = 0;
      }
    }
  }

  return PNG.sync.write(png).toString('base64');
}

function documentFor(id: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id, kind: 'route' },
    html: `<div data-va-path="0">${id}</div>`,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

interface Page {
  /** Moves the `token` band: a declared value, same boxes. */
  readonly colour?: string;
  /** Moves the `geometry` band: the nav is somewhere else. */
  readonly navX?: number;
  /** Moves the `a11y` band: a control lost its name. */
  readonly navName?: string;
  /** Moves the `content` band. */
  readonly heading?: string;
}

/**
 * A route: a shell containing a nav, both attributed to components.
 *
 * Provenance matters here and does not elsewhere in this file — component hashes
 * are keyed on the owning component, and a page with no owners collapses into
 * one `(unattributed)` bucket where every band change looks like the same
 * component's. That would still exercise the banding and would stop exercising
 * the thing a route is: several components, only some of which moved.
 */
function snapshotOf(page: Page): SemanticSnapshot {
  return {
    formatVersion: 1,
    subject: { id: 'route/home', kind: 'route' },
    profile: {
      id: 'chromium',
      layout: true,
      computedStyle: true,
      accessibility: 'engine',
      pseudoElements: true,
      raster: true,
    },
    environment: { inputs: {}, digest: 'v1:x', semanticDigest: 'v1:y' } as never,
    renderHash: 'v1:r',
    structureHash: 'v1:s',
    styleHash: 'v1:t',
    root: {
      path: '0',
      tag: 'div',
      attributes: {},
      style: { 'background-color': page.colour ?? 'rgb(255, 255, 255)' },
      rect: { x: 0, y: 0, width: 60, height: 60 },
      provenance: { owners: [{ name: 'Shell', props: {} }] },
      children: [
        {
          path: '0/0',
          tag: 'nav',
          role: 'navigation',
          name: page.navName ?? 'Main',
          attributes: {},
          style: {},
          rect: { x: page.navX ?? 4, y: 4, width: 20, height: 8 },
          provenance: { owners: [{ name: 'Nav', props: {} }, { name: 'Shell', props: {} }] },
          children: [
            {
              path: '0/0/0',
              tag: '#text',
              attributes: {},
              style: {},
              text: page.heading ?? 'Home',
              children: [],
            },
          ],
        },
      ],
    },
    styleProvenance: [],
    diagnostics: [],
  } as unknown as SemanticSnapshot;
}

function rendererFor(images: ReadonlyMap<string, string>): Renderer {
  return {
    identity: MACHINE,
    identityFor(document) {
      return { ...MACHINE, deviceScaleFactor: document.viewport.deviceScaleFactor };
    },
    async render(document): Promise<Raster> {
      return {
        documentDigest: documentDigest(document),
        identity: { ...MACHINE, deviceScaleFactor: document.viewport.deviceScaleFactor },
        width: 60,
        height: 60,
        bytes: images.get(document.subject.id)!,
        missingFonts: [],
      };
    },
    async close() {
      /* nothing to release */
    },
  };
}

/**
 * A durable store, in a `Map`.
 *
 * `createEphemeralStore` cannot serve this suite: its `find` returns `null` by
 * design, because the ephemeral mode has no past. What is under test *is* the
 * past — specifically the `components` a baseline carried — so the store here
 * keeps one, and keeps nothing else about what a real backend does.
 */
function durableStore(): RasterStore {
  const baselines = new Map<string, Raster>();
  const cache = new Map<string, Raster>();

  return {
    retention: 'durable',
    async find(key: BaselineKey, identity: RenderIdentity): Promise<Found | null> {
      const raster = baselines.get(key.subject);
      if (raster === undefined) return null;
      return {
        raster,
        comparable: identityDigest(raster.identity) === identityDigest(identity),
        storedUnder: raster.identity,
      };
    },
    async describe(key: BaselineKey, identity: RenderIdentity): Promise<Described | null> {
      const raster = baselines.get(key.subject);
      if (raster === undefined) return null;
      return {
        documentDigest: raster.documentDigest,
        comparable: identityDigest(raster.identity) === identityDigest(identity),
        storedUnder: raster.identity,
        missingFonts: raster.missingFonts,
        ...(raster.components !== undefined ? { components: raster.components } : {}),
      };
    },
    async put(key: BaselineKey, raster: Raster): Promise<void> {
      baselines.set(key.subject, raster);
    },
    renderCache: neverFails({
      async get(digest, identity): Promise<Raster | null> {
        return cache.get(`${digest}/${identityDigest(identity)}`) ?? null;
      },
      async put(raster): Promise<void> {
        cache.set(`${raster.documentDigest}/${identityDigest(raster.identity)}`, raster);
      },
    }),
  };
}

const KEY = { subject: 'route/home' };
const BLANK = image(null);
/** The same difference in every case: 64 pixels, in the same place. */
const MARK = image({ x: 30, y: 30, size: 8 });

/**
 * Put a baseline in the store, then observe against it with a sensitivity.
 *
 * The baseline is written by hand rather than by a first run, because a run does
 * not write one — `variance run` reports `new` and `variance accept` promotes
 * the image the run already produced (ADR-0021). What matters here is that the
 * stored raster carries **`components`**, which is the sidecar field the whole
 * mechanism reads, so it is built the way the store would have it.
 */
async function secondRun(
  baseline: Page,
  now: Page,
  level?: Level,
): ReturnType<typeof observeAgainstBaseline> {
  const store: RasterStore = durableStore();
  const document = documentFor('route/home');
  const renderer = rendererFor(new Map([['route/home', MARK]]));

  await store.put(KEY, {
    documentDigest: 'v1:whatever-the-previous-run-painted',
    identity: MACHINE,
    width: 60,
    height: 60,
    bytes: BLANK,
    missingFonts: [],
    components: hashComponents(snapshotOf(baseline)),
  });

  return await observeAgainstBaseline(document, KEY, {
    renderer,
    store,
    snapshot: snapshotOf(now),
    ...(level === undefined
      ? {}
      : {
          sensitivity: {
            rule: 'routes',
            reason: 'a route asserts the page assembles, not what it is painted',
            level,
          },
        }),
  });
}

describe('a rebrand across a route, which is what `layout` exists for', () => {
  const REBRAND: Page = { colour: 'rgb(255, 0, 0)' };

  it('is reported in full when the route asserts on everything', async () => {
    // The control, and it has to come first. Without it every assertion below
    // would pass for a comparison that quietly found nothing at all.
    const observation = await secondRun({}, REBRAND);

    expect(observation.verdict).toBe('changed');
  });

  it('is absorbed when the route asserts on layout', async () => {
    const observation = await secondRun({}, REBRAND, 'layout');

    // Green, and the word is not `unchanged` — a difference was absorbed by a
    // declaration somebody wrote, and the ledger has to be able to say so.
    expect(observation.verdict).toBe('ignored');
    expect(observation.because).toContain('token');
    expect(observation.because).toContain('asserts on layout');
    expect(observation.because).toContain('a route asserts the page assembles');
  });

  it('pays for no isolation, which is why a relaxed route is cheap', async () => {
    const observation = await secondRun({}, REBRAND, 'layout');

    // The decision is taken before the mask is clustered, attributed and
    // fingerprinted — the expensive half of a comparison. Forty routes in a
    // token PR pay one hash comparison each instead of forty isolations, and if
    // this ever starts producing regions the saving has silently gone.
    expect(observation.regions).toEqual([]);
    expect(observation.isolation).toBeUndefined();
  });
});

describe('what `layout` still reports, however it is painted', () => {
  it('reports a nav that moved, because geometry is asserted on', async () => {
    const observation = await secondRun({}, { navX: 30 }, 'layout');

    // The property that makes this not a threshold. A nav that moved by pixels
    // is reported at `layout`; a rebrand that repainted every surface is not.
    // Size is not what decides — the kind of thing that moved is.
    expect(observation.verdict).toBe('changed');
  });

  it('reports a control that lost its accessible name', async () => {
    const observation = await secondRun({}, { navName: 'Nav' }, 'layout');

    // `a11y` is in every level deliberately. A route test blind to it would be
    // asserting on the shape of the page while ignoring the shape a screen
    // reader sees — and this change repaints nothing and moves no box, so the
    // pixels cannot report it either.
    expect(observation.verdict).toBe('changed');
  });

  it('reports a rebrand that also moved the nav, rather than half of it', async () => {
    const observation = await secondRun({}, { colour: 'rgb(255, 0, 0)', navX: 30 }, 'layout');

    // The whole subject, including the band that would have been absorbed on its
    // own. A reviewer looking at a nav that moved wants the restyle that came
    // with it; showing half a diff is worse than showing none of it.
    expect(observation.verdict).toBe('changed');
  });
});

describe('what a level absorbs, and what it must never', () => {
  it('absorbs a copy edit at `layout` and reports it at `content`', async () => {
    // The same edit, two declarations, opposite verdicts — which is the whole
    // claim that these are bands and not a tolerance.
    expect((await secondRun({}, { heading: 'Welcome' }, 'layout')).verdict).toBe('ignored');
    expect((await secondRun({}, { heading: 'Welcome' }, 'content')).verdict).toBe('changed');
  });

  it('absorbs nothing at `strict`, which is the default everywhere', async () => {
    expect((await secondRun({}, { colour: 'rgb(255, 0, 0)' }, 'strict')).verdict).toBe('changed');
  });

  it('reports in full when the baseline carries no component hashes', async () => {
    const store: RasterStore = durableStore();
    const renderer = rendererFor(new Map([['route/home', MARK]]));

    // A baseline written before the hashes existed — or by a store that dropped
    // them — cannot be asked which bands moved. A declaration that cannot be
    // evaluated has *not* been satisfied; the alternative is a relaxed route
    // going green against an older baseline for reasons nobody could
    // reconstruct.
    await store.put(KEY, {
      documentDigest: 'v1:older-than-the-sidecar-field',
      identity: MACHINE,
      width: 60,
      height: 60,
      bytes: BLANK,
      missingFonts: [],
    });

    const observation = await observeAgainstBaseline(documentFor('route/home'), KEY, {
      renderer,
      store,
      snapshot: snapshotOf({ colour: 'rgb(255, 0, 0)' }),
      sensitivity: { rule: 'routes', reason: 'assembles', level: 'layout' },
    });

    expect(observation.verdict).toBe('changed');
  });
});
