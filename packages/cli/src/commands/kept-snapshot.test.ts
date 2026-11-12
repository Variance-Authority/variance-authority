import { describe, expect, it } from 'vitest';
import {
  environmentKey,
  profileById,
  type SemanticSnapshot,
} from '@variance-authority/core/format';
import { packSnapshot } from '@variance-authority/observe';
import type { Found, Renderer } from '@variance-authority/raster';
import type { Plan } from './run.js';
import {
  VIEWPORT,
  collectorOf,
  configOf,
  documentFor,
  painter,
  runWith,
  storeAnswering,
  whiteBaselineOf,
} from './run-fixture.js';

/**
 * A baseline whose document has not moved, and which kept no snapshot of its
 * nodes.
 *
 * The digest settles such a subject without a render, so no `Observation` is
 * built, and the mark an accepting run re-stamps on is never set. Left there,
 * the baseline gains its snapshot only when something changes, which is the
 * day it was needed. So the run renders it, once, for `variance accept` to
 * record one.
 */

const ID = 'fixture:a';

const plan: Plan = {
  subjects: [{ subject: { id: ID, kind: 'fixture' } }],
  notObserved: [],
  warnings: [],
};

const SNAPSHOT: SemanticSnapshot = {
  formatVersion: 1,
  subject: { id: ID, kind: 'fixture' },
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
  diagnostics: [],
};

const collector = collectorOf(plan, () => ({ ok: true, document: documentFor(ID), snapshot: SNAPSHOT }));

function counting(): Renderer & { renders: () => number } {
  const inner = painter();
  let renders = 0;
  return {
    ...inner,
    async render(document) {
      renders += 1;
      return await inner.render(document);
    },
    renders: () => renders,
  };
}

describe('a digest-matched baseline that kept no snapshot', () => {
  it('is rendered, and marked for an accepting run to record one', async () => {
    const renderer = counting();
    const { report } = await runWith(configOf(), collector, storeAnswering(whiteBaselineOf(documentFor(ID))), {
      renderer,
    });

    expect(renderer.renders()).toBe(1);
    expect(report.observations[0]?.verdict).toBe('unchanged');
    expect(report.observations[0]?.signals?.snapshot).toBe('unrecorded');
  });

  it('settles without a render once it kept one', async () => {
    const renderer = counting();
    const baseline: Found = whiteBaselineOf(documentFor(ID));
    const kept: Found = { ...baseline, raster: { ...baseline.raster, snapshot: packSnapshot(SNAPSHOT) } };

    const { report } = await runWith(configOf(), collector, storeAnswering(kept), { renderer });

    expect(renderer.renders()).toBe(0);
    expect(report.observations[0]?.verdict).toBe('unchanged');
    expect(report.observations[0]?.signals).not.toHaveProperty('snapshot');
  });
});
