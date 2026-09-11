import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  attributeMovement,
  attributeRegions,
  componentInstances,
  composeSubjects,
  formatSource,
  indexSource,
  isolateRegions,
  locateInstability,
  mergeSourceIndexes,
  rankRegions,
  resolveSource,
  type RankedRegion,
} from '@variance-authority/core/attribute';
import { diffSnapshots } from '@variance-authority/core/compare';
import type { SemanticSnapshot } from '@variance-authority/core/format';
import { buildDocket } from '@variance-authority/core/judge';
import { normalize } from '@variance-authority/core/rules';
import { createHarness, type Harness } from '@variance-authority/playwright';
import { comparePngs } from '@variance-authority/png';
import { pageAgentBundle } from '../test/page-agent-bundle.js';

const BROWSER_AVAILABLE = (() => {
  try { return existsSync(chromium.executablePath()); } catch { return false; }
})();
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VIEWPORT = { width: 260, height: 120, deviceScaleFactor: 1, colorScheme: 'light' } as const;
const SUBJECT = 'route/product-card';
const CONTROL = 'route/product-card-control';
const SOURCE = mergeSourceIndexes([
  indexSource('src/price-tag.tsx', readFileSync(join(HERE, 'price-tag.tsx'), 'utf8')),
  indexSource('src/dynamic-image.tsx', readFileSync(join(HERE, 'dynamic-image.tsx'), 'utf8')),
]);

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\nexamples/dynamic-route-flake: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

async function waitForImage(harness: Harness): Promise<void> {
  await harness.page.locator('img').evaluate((element) => (element as HTMLImageElement).decode());
}

async function origin(harness: Harness): Promise<{ x: number; y: number }> {
  return harness.page.locator('#subject').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
}

function causes(before: SemanticSnapshot, after: SemanticSnapshot): readonly string[] {
  return buildDocket([diffSnapshots(before, after)]).entries.flatMap((entry) =>
    entry.components.filter((component) => component.role === 'root').map((component) => component.name),
  );
}

let baseline: SemanticSnapshot | undefined;
let changed: SemanticSnapshot | undefined;
let repeat: SemanticSnapshot | undefined;
let changedRegions: readonly RankedRegion[] = [];
let repeatRegions: readonly RankedRegion[] = [];
let activeCauses: readonly string[] = [];
let activePixels = 0;
let repeatPixels = 0;
let firstDocument = '';
let secondDocument = '';

async function read(variant: 'before' | 'after', image: string) {
  const local = await createHarness({
    url: pathToFileURL(join(ROOT, 'page', 'harness.html')).href,
    bundle: await pageAgentBundle(),
    viewport: VIEWPORT,
    subjectId: () => SUBJECT,
    prepare: async (page) => {
      await page.route('**/dynamic-image.svg', (route) =>
        route.fulfill({
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="${image}"/></svg>`,
          contentType: 'image/svg+xml',
          headers: { 'cache-control': 'no-store' },
        }),
      );
    },
  });

  try {
    const snapshot = normalize(await local.capture(SUBJECT, variant));
    await waitForImage(local);
    return {
      snapshot,
      png: await local.page.locator('#subject').screenshot(),
      document: await local.page.content(),
      origin: await origin(local),
    };
  } finally {
    await local.close();
  }
}

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  const before = await read('before', '#0969da');
  const active = await read('after', '#cf222e');
  const again = await read('after', '#0969da');
  baseline = before.snapshot;
  changed = active.snapshot;
  repeat = again.snapshot;
  firstDocument = active.document;
  secondDocument = again.document;

  activeCauses = causes(baseline, changed);
  const activeComparison = comparePngs(before.png, active.png);
  activePixels = activeComparison.changed.default;
  changedRegions = rankRegions(
    attributeRegions(isolateRegions(activeComparison.mask).regions, changed, {
      scale: VIEWPORT.deviceScaleFactor,
      origin: active.origin,
    }),
    activeCauses,
  );

  const repeatComparison = comparePngs(active.png, again.png);
  repeatPixels = repeatComparison.changed.default;
  repeatRegions = rankRegions(
    attributeRegions(isolateRegions(repeatComparison.mask).regions, repeat, {
      scale: VIEWPORT.deviceScaleFactor,
      origin: again.origin,
    }),
  );
}, 120_000);

describe.skipIf(!BROWSER_AVAILABLE)('a dynamic Playwright image route', () => {
  it('changes same-URL image bytes in an otherwise unchanged image element', () => {
    expect(activePixels).toBeGreaterThan(0);
    expect(firstDocument).toContain('http://dynamic-route.test/dynamic-image.svg');
    expect(secondDocument).toBe(firstDocument);
    expect(repeatPixels).toBeGreaterThan(0);
  });

  it('projects changed pixels through the existing region, DOM, Fiber, and source path', () => {
    const image = changedRegions.find((region) => region.component === 'DynamicImage');
    const price = changedRegions.find((region) => region.component === 'PriceTag');
    expect(image).toMatchObject({ unattributed: false, component: 'DynamicImage', cause: false });
    expect(price).toMatchObject({ unattributed: false, component: 'PriceTag', cause: true });
    expect(formatSource(resolveSource('DynamicImage', SOURCE)!)).toMatch(/^src\/dynamic-image\.tsx:\d+$/);
    expect(formatSource(resolveSource('PriceTag', SOURCE)!)).toMatch(/^src\/price-tag\.tsx:\d+$/);
  });

  it('keeps the source-backed PriceTag change reviewable in composition', () => {
    const price = changedRegions.find((region) => region.component === 'PriceTag');
    expect(price?.component).toBe('PriceTag');
    const composition = composeSubjects([
      { subject: SUBJECT, instances: componentInstances(changed!) },
      { subject: CONTROL, instances: componentInstances(repeat!) },
    ]);
    const attribution = attributeMovement(
      [{ subject: SUBJECT, component: price!.component!, bands: ['style'] }],
      composition,
      {
        changed: ['src/price-tag.tsx'],
        declaredIn: new Map([
          ['PriceTag', ['src/price-tag.tsx']],
          ['DynamicImage', ['src/dynamic-image.tsx']],
        ]),
      },
    );
    expect(attribution.movements).toContainEqual(expect.objectContaining({ component: 'PriceTag', cause: 'edited' }));
    expect(attribution.flakes).toEqual([]);
  });

  it('calls the repeated image-only difference sub-semantic instability, not a source change', () => {
    const image = repeatRegions.find((region) => region.component === 'DynamicImage');
    const instability = locateInstability(changed!, repeat!, { pixelsDiffer: repeatPixels > 0 });
    expect(image).toMatchObject({ unattributed: false, component: 'DynamicImage', cause: false });
    expect(instability).toMatchObject({ stable: false, band: 'sub-semantic', locations: [] });
    expect(instability.because).toContain('no component is responsible');
  });
});
