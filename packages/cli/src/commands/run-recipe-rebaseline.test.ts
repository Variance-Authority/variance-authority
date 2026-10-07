import { describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
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

/** The run collects a different document for `fixture:a` than the baseline was painted from. */
const movedCollector = collectorOf(plan, (subject) => ({
  ok: true,
  document: documentFor(subject.subject.id, '<div data-va-path="0">y</div>'),
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
    read: async () => rasterFor(documentFor('fixture:a'), NEW_RECIPE) satisfies Raster,
  });
  return { result, puts };
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

    const { result, puts } = await acceptFrom(report, { all: true });
    expect(result.accepted.map((entry) => entry.subject)).toEqual(['fixture:a']);
    expect(puts).toEqual([{ subject: 'fixture:a' }]);
  });

  it('paints a subject whose document moved too, which `accept --all` skips and naming it adopts', async () => {
    // Nothing compared this image against anything: the baseline is under the
    // old recipe and the document is not the one it was painted from. Adopting
    // it in bulk would make a change nobody looked at the baseline, so `--all`
    // skips it and says to name it; naming it is the review.
    const { report } = await runWith(configOf(), movedCollector, storeAnswering(storedUnder(OLD_RECIPE)), {
      renderer: fakeRenderer(NEW_RECIPE),
    });

    const [observation] = report.observations;
    expect(observation?.verdict).toBe('incomparable');
    expect(observation?.because).toContain('the document changed too');
    expect(observation?.signals?.document).toBe('changed');
    expect(observation?.images?.after).toBeDefined();

    const bulk = await acceptFrom(report, { all: true });
    expect(bulk.puts).toEqual([]);
    expect(bulk.result.accepted).toEqual([]);
    expect(bulk.result.refused).toEqual([
      { subject: 'fixture:a', because: expect.stringContaining('variance accept fixture:a') },
    ]);

    const named = await acceptFrom(report, { subjects: ['fixture:a'] });
    expect(named.result.refused).toEqual([]);
    expect(named.puts).toEqual([{ subject: 'fixture:a' }]);
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
