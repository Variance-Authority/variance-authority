import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { Found } from '@variance-authority/raster';
import { promotionOf } from '@variance-authority/report';
import type { Plan } from './run.js';
import {
  IDENTITY,
  VIEWPORT,
  collectorOf,
  configOf,
  documentFor,
  fakeRenderer,
  rasterFor,
  runWith,
  storeAnswering,
} from './run-fixture.js';

/**
 * A baseline this machine painted under an older recipe of this tool.
 *
 * The case an upgrade produces on every subject at once: the rasterization key
 * moved because variance-authority changed what it digests, and nothing about
 * the machine did. The run has to leave an image `accept --all` can promote,
 * because the reason it prints names that command — a remedy the run made
 * impossible would be a sentence the product cannot keep.
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

/** The baseline for `fixture:a`, stored under `storedUnder` and not comparable here. */
function storedUnder(identity: RenderIdentity): Found {
  const scaled = { ...identity, deviceScaleFactor: VIEWPORT.deviceScaleFactor };
  return {
    raster: rasterFor(documentFor('fixture:a'), scaled),
    comparable: false,
    storedUnder: scaled,
  };
}

// The two rasterization digests of the 0.15.0 upgrade, before and after
// 3fdec678: one machine, and a key that moved without a pixel.
const OLD_RECIPE: RenderIdentity = { ...IDENTITY, rasterization: 'v1:8040e1a2e35d148b301ebd30e5ed66c6' };
const NEW_RECIPE: RenderIdentity = { ...IDENTITY, rasterization: 'v1:54323cded938fde38b41cdd3865368fe' };

describe('a run against a baseline from an older recipe', () => {
  it('paints the subject, so `accept --all` has a candidate to promote', async () => {
    const { report } = await runWith(configOf(), collector, storeAnswering(storedUnder(OLD_RECIPE)), {
      renderer: fakeRenderer(NEW_RECIPE),
    });

    const [observation] = report.observations;
    expect(observation?.verdict).toBe('incomparable');
    expect(observation?.because).toContain('rasterization e5ed66c6 → 865368fe');
    expect(observation?.because).toContain('only the recipe moved');
    expect(observation?.because).toContain('`variance accept --all`');
    expect(observation?.images?.after).toBeDefined();
    expect(promotionOf(observation!).kind).toBe('promotable');
  });

  it('paints nothing when this run records no recipe, since nothing shows the machine is the same', async () => {
    // A renderer that predates the field records no rasterization digest.
    // Absent is "did not say", not a recipe of its own, so the run cannot tell
    // this from another machine and keeps the refusal.
    const { report } = await runWith(configOf(), collector, storeAnswering(storedUnder(OLD_RECIPE)), {
      renderer: fakeRenderer(IDENTITY),
    });

    const [observation] = report.observations;
    expect(observation?.verdict).toBe('incomparable');
    expect(observation?.because).toContain('rasterization e5ed66c6 → not recorded');
    expect(observation?.because).not.toContain('accept');
    expect(observation?.images).toBeUndefined();
  });

  it('still paints nothing against another machine’s baseline', async () => {
    // The refusal the partition exists for: an image of this machine against
    // another's is a diff of the machines.
    const { report } = await runWith(
      configOf(),
      collector,
      storeAnswering(storedUnder({ ...IDENTITY, platform: 'darwin/arm64' })),
    );

    const [observation] = report.observations;
    expect(observation?.verdict).toBe('incomparable');
    expect(observation?.because).toContain('platform darwin/arm64 → linux/x64');
    expect(observation?.images).toBeUndefined();
  });
});
