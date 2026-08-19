import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attributeRegions,
  buildDocket,
  diffSnapshots,
  formatSource,
  indexSource,
  isolateRegions,
  mergeSourceIndexes,
  normalize,
  rankRegions,
  resolveSource,
  type RankedRegion,
  type SemanticDiff,
} from '@variance-authority/core';
import { createHarness, type Harness } from '@variance-authority/playwright';
import { comparePngs } from '@variance-authority/png';
import type { Variant } from './workspace.js';
import { pageAgentBundle } from '../test/page-agent-bundle.js';

const BROWSER_AVAILABLE = (() => {
  try { return existsSync(chromium.executablePath()); } catch { return false; }
})();
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VIEWPORT = { width: 640, height: 220, deviceScaleFactor: 1, colorScheme: 'light' } as const;
const SUBJECT = 'workspace/sidebar';
const SOURCE = mergeSourceIndexes([
  indexSource('src/heading.tsx', readFileSync(join(HERE, 'heading.tsx'), 'utf8')),
  indexSource('src/side-panel.tsx', readFileSync(join(HERE, 'side-panel.tsx'), 'utf8')),
  indexSource('src/action-button.tsx', readFileSync(join(HERE, 'action-button.tsx'), 'utf8')),
]);

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\nexamples/layout-impact: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

async function read(harness: Harness, variant: Variant) {
  const snapshot = normalize(await harness.capture(SUBJECT, variant));
  const sidebar = await harness.page.locator('[aria-label="Sidebar"]').boundingBox();
  const button = await harness.page.getByRole('button', { name: 'Save changes' }).boundingBox();
  const origin = await harness.page.locator('#subject').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  return {
    snapshot,
    png: await harness.page.locator('#subject').screenshot(),
    origin,
    sidebar: sidebar!,
    button: button!,
  };
}

function regions(before: Awaited<ReturnType<typeof read>>, after: Awaited<ReturnType<typeof read>>, causes: readonly string[]): readonly RankedRegion[] {
  const comparison = comparePngs(before.png, after.png);
  return rankRegions(
    attributeRegions(isolateRegions(comparison.mask).regions, after.snapshot, {
      scale: VIEWPORT.deviceScaleFactor,
      origin: after.origin,
    }),
    causes,
  );
}

let harness: Harness | undefined;
let base: Awaited<ReturnType<typeof read>> | undefined;
let heading: Awaited<ReturnType<typeof read>> | undefined;
let layout: Awaited<ReturnType<typeof read>> | undefined;
let structural: Awaited<ReturnType<typeof read>> | undefined;
let headingDiff: SemanticDiff | undefined;
let layoutDiff: SemanticDiff | undefined;
let structureDiff: SemanticDiff | undefined;
let headingRegions: readonly RankedRegion[] = [];

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  harness = await createHarness({
    url: pathToFileURL(join(ROOT, 'page', 'harness.html')).href,
    bundle: await pageAgentBundle(),
    viewport: VIEWPORT,
    subjectId: () => SUBJECT,
  });
  base = await read(harness, 'base');
  heading = await read(harness, 'heading-style');
  layout = await read(harness, 'layout');
  structural = await read(harness, 'structure');
  headingDiff = diffSnapshots(base.snapshot, heading.snapshot);
  layoutDiff = diffSnapshots(base.snapshot, layout.snapshot);
  structureDiff = diffSnapshots(base.snapshot, structural.snapshot);
  const headingCauses = buildDocket([headingDiff]).entries.flatMap((entry) =>
    entry.components.filter((component) => component.role === 'root').map((component) => component.name),
  );
  headingRegions = regions(base, heading, headingCauses);
}, 120_000);

afterAll(async () => { await harness?.close(); harness = undefined; });

describe.skipIf(!BROWSER_AVAILABLE)('source cause and layout impact', () => {
  it('places the changed Heading pixels in the Sidebar and resolves the responsible source', () => {
    const headingRegion = headingRegions.find((region) => region.component === 'Heading');
    const docket = buildDocket([headingDiff!]);
    expect(headingRegion).toMatchObject({ component: 'Heading', cause: true, unattributed: false });
    expect(headingRegion?.where).toContain('complementary "Sidebar"');
    expect(docket.entries).toContainEqual(expect.objectContaining({ label: 'Heading', band: 'token', structureIntact: true }));
    expect(formatSource(resolveSource('Heading', SOURCE)!)).toMatch(/^src\/heading\.tsx:\d+$/);
  });

  it('reports the 50px panel and 4px button growth as geometry caused by style values', () => {
    expect(layout!.sidebar.width - base!.sidebar.width).toBe(50);
    expect(layout!.button.height - base!.button.height).toBe(4);
    const deltas = layoutDiff!.deltas;
    expect(deltas.some((delta) => delta.kind === 'style-changed' && delta.band === 'token')).toBe(true);
    expect(deltas.some((delta) => delta.kind === 'rect-changed' && delta.band === 'geometry')).toBe(true);
    expect(deltas).toContainEqual(
      expect.objectContaining({
        kind: 'style-changed',
        band: 'token',
        createdBy: 'ActionButton',
        property: 'height',
      }),
    );
    expect(deltas).toContainEqual(
      expect.objectContaining({
        kind: 'rect-changed',
        band: 'geometry',
        createdBy: 'ActionButton',
      }),
    );
    const docket = buildDocket([layoutDiff!]);
    expect(docket.entries).toContainEqual(expect.objectContaining({ label: 'SidePanel', band: 'geometry', structureIntact: true }));
    expect(docket.entries[0]?.components).toContainEqual(
      expect.objectContaining({ name: 'ActionButton', role: 'collateral' }),
    );
  });

  it('reports the sidebar landmark change as structural/semantic, separately from paint and size', () => {
    expect(structureDiff!.deltas.some((delta) => delta.kind === 'role-changed' || delta.kind === 'node-added' || delta.kind === 'node-removed')).toBe(true);
    const docket = buildDocket([structureDiff!]);
    expect(docket.entries).toContainEqual(
      expect.objectContaining({
        kind: 'prop',
        label: 'Workspace',
        structureIntact: false,
      }),
    );
    expect(docket.entries[0]?.components).toContainEqual(
      expect.objectContaining({ name: 'SidePanel', role: 'root' }),
    );
    expect(structureDiff!.deltas.some((delta) => delta.kind === 'style-changed')).toBe(false);
  });
});
