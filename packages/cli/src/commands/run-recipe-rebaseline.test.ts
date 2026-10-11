import { describe, expect, it } from 'vitest';
import { documentDigest, type RenderIdentity } from '@variance-authority/core/format';
import type { Renderer } from '@variance-authority/raster';
import type { BaselineKey, Found, RasterStore } from '@variance-authority/raster';
import { createEphemeralStore } from '@variance-authority/raster';
import { promotionOf } from '@variance-authority/report';
import { accept } from './accept.js';
import type { CliRunReport, Plan } from './run.js';
import {
  IDENTITY,
  VIEWPORT,
  collectorOf,
  configOf,
  documentFor,
  painter,
  runWith,
  storeAnswering,
  WHITE,
} from './run-fixture.js';

/**
 * A baseline painted under another identity: an older recipe of this tool, or
 * another machine.
 *
 * The case an upgrade produces on every subject at once. The run compares
 * anyway and names what moved as the cause (ADR-0090): a subject whose pixels
 * did not move says so, and one whose pixels moved is `changed` like any other,
 * with an image `accept` can promote.
 */

const plan: Plan = {
  subjects: [{ subject: { id: 'fixture:a', kind: 'fixture' } }],
  notObserved: [],
  warnings: [],
};

const collector = collectorOf(plan, (subject) => ({
  ok: true,
  document: documentFor(subject.subject.id),
}));

/** The baseline for `fixture:a`, painted white under `identity`, a sibling of this run's. */
function storedUnder(identity: RenderIdentity): Found {
  const scaled = { ...identity, deviceScaleFactor: VIEWPORT.deviceScaleFactor };
  const raster = { ...whiteRaster(), identity: scaled };
  return { raster, comparable: false, storedUnder: scaled };
}

function whiteRaster() {
  const document = documentFor('fixture:a');
  return { documentDigest: documentDigest(document), width: 10, height: 10, bytes: WHITE, missingFonts: [] };
}

/** `painter()`, under `identity`: white, or black for a document marked dark. */
function painterUnder(identity: RenderIdentity): Renderer {
  const base = painter();
  const scaled = (document: { readonly viewport: { readonly deviceScaleFactor: number } }) => ({
    ...identity,
    deviceScaleFactor: document.viewport.deviceScaleFactor,
  });
  return {
    ...base,
    identity,
    identityFor: scaled,
    async render(document) {
      return { ...(await base.render(document)), identity: scaled(document) };
    },
  };
}

/** The run collects a document for `fixture:a` that paints black. */
const movedCollector = collectorOf(plan, (subject) => ({
  ok: true,
  document: documentFor(subject.subject.id, '<div data-va-path="0" data-paint="dark">y</div>'),
}));

/** `variance accept` over a report, against a store that records what it was handed. */
async function acceptFrom(
  report: CliRunReport,
  selection: { readonly all: true } | { readonly subjects: readonly string[] },
): Promise<{ readonly result: Awaited<ReturnType<typeof accept>>; readonly puts: readonly BaselineKey[] }> {
  const puts: BaselineKey[] = [];
  const store: RasterStore = {
    ...createEphemeralStore(),
    retention: 'durable',
    async put(key) {
      puts.push(key);
    },
  };
  const result = await accept({
    report,
    reportDir: '/repo/out',
    store,
    subjects: 'subjects' in selection ? selection.subjects : [],
    all: 'all' in selection,
    read: async () => ({ ...whiteRaster(), identity: NEW_RECIPE }),
  });
  return { result, puts };
}

// The two rasterization digests of the 0.15.0 upgrade, before and after
// 3fdec678: one machine, and a key that moved without a pixel.
const OLD_RECIPE: RenderIdentity = { ...IDENTITY, rasterization: 'v1:8040e1a2e35d148b301ebd30e5ed66c6' };
const NEW_RECIPE: RenderIdentity = { ...IDENTITY, rasterization: 'v1:54323cded938fde38b41cdd3865368fe' };

describe('a run against a baseline painted under another identity', () => {
  it('compares across a recipe upgrade and says the subject did not move', async () => {
    const { report } = await runWith(configOf(), collector, storeAnswering(storedUnder(OLD_RECIPE)), {
      renderer: painterUnder(NEW_RECIPE),
    });

    const [observation] = report.observations;
    expect(observation?.verdict).toBe('unchanged');
    expect(observation?.signals?.identity).toBe('recipe');
    expect(observation?.signals?.moved).toEqual(['rasterization e5ed66c6 → 865368fe']);
    expect(observation?.because).toContain('rasterization e5ed66c6 → 865368fe');
  });

  it('shows a change under a recipe upgrade, with the recipe as its cause, and accepts it like any other', async () => {
    const { report } = await runWith(configOf(), movedCollector, storeAnswering(storedUnder(OLD_RECIPE)), {
      renderer: painterUnder(NEW_RECIPE),
    });

    const [observation] = report.observations;
    expect(observation?.verdict).toBe('changed');
    expect(observation?.signals?.identity).toBe('recipe');
    expect(observation?.because).toContain('rasterization e5ed66c6 → 865368fe');
    expect(observation?.images?.after).toBeDefined();
    expect(promotionOf(observation!).kind).toBe('promotable');

    const { result, puts } = await acceptFrom(report, { all: true });
    expect(result.refused).toEqual([]);
    expect(result.accepted.map((entry) => entry.subject)).toEqual(['fixture:a']);
    expect(puts).toEqual([{ subject: 'fixture:a' }]);
  });

  it('names a recipe this run did not record as moved, rather than guessing it is the same', async () => {
    // A renderer that predates the field records no rasterization digest.
    // Absent is "did not say", so the cause cannot be narrowed to the recipe.
    const { report } = await runWith(configOf(), movedCollector, storeAnswering(storedUnder(OLD_RECIPE)), {
      renderer: painterUnder(IDENTITY),
    });

    const [observation] = report.observations;
    expect(observation?.verdict).toBe('changed');
    expect(observation?.signals?.identity).toBe('machine');
    expect(observation?.because).toContain('rasterization e5ed66c6 → not recorded');
  });

  it('compares against another machine’s baseline and names the platform as the cause', async () => {
    const { report } = await runWith(
      configOf(),
      movedCollector,
      storeAnswering(storedUnder({ ...IDENTITY, platform: 'darwin/arm64' })),
      { renderer: painterUnder(IDENTITY) },
    );

    const [observation] = report.observations;
    expect(observation?.verdict).toBe('changed');
    expect(observation?.signals?.identity).toBe('machine');
    expect(observation?.signals?.moved).toEqual(['platform darwin/arm64 → linux/x64']);
    expect(observation?.images?.after).toBeDefined();
  });
});
