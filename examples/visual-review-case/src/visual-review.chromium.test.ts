import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comparePngs, diffImage } from '@variance-authority/png';
import { ARTIFACT_ROOT, REPOSITORY_ROOT, runVisualReviewCase } from '../scripts/run-case.mjs';

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\nexamples/visual-review-case: the cases that paint skipped.\n  no browser — npx playwright install chromium\n',
  );
}

/**
 * The report with its pixel counts blanked. One Chromium build rasterizes text
 * differently on macOS and Linux by a glyph edge, so the counts are a claim
 * about the committed PNGs, checked below; every other word is this run's.
 */
const shape = (report: string) => report.replace(/[\d,]+ pixels/g, 'N pixels').replace(/\d+px/g, 'Npx');

let result: Awaited<ReturnType<typeof runVisualReviewCase>> | undefined;

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  result = await runVisualReviewCase();
}, 120_000);

afterAll(() => {
  result = undefined;
});

describe.skipIf(!BROWSER_AVAILABLE)('the visual-review example', () => {
  it('tells the button that changed colour from the name that changed shape', () => {
    const changes = Object.fromEntries(result!.ranked.map((region) => [region.component, region.region.change]));
    expect(changes).toEqual({ ChooseButton: 'colour', PlanName: 'shape', Price: 'shape' });
  });

  it('reports the price the longer name pushed down as displaced, not as a cause', () => {
    expect(result!.observation.causes).toEqual(['ChooseButton', 'PlanName']);
    expect(result!.ranked.find((region) => region.component === 'Price')?.cause).toBe(false);
  });

  it('names the bands each moved component changed in', () => {
    expect(
      Object.fromEntries((result!.observation.moved ?? []).map((entry) => [entry.component, entry.bands])),
    ).toEqual({ ChooseButton: ['token'], PlanName: ['a11y', 'geometry', 'content'], Price: ['geometry'] });
  });

  it('places every region on a landmark path and a declaration line', () => {
    for (const region of result!.ranked) {
      expect(region.where).toMatch(/^main → region "Plans" → list item 2 of 3/);
    }
  });

  it('shares the generated report without rewriting it', async () => {
    const committed = await readFile(join(ARTIFACT_ROOT, 'report.txt'), 'utf8');
    expect(shape(committed)).toBe(shape(`${result!.report}\n`));
  });

  it('records which browser produced the artifacts and which components caused the change', async () => {
    const { changedPixels, raster, engine, ...provenance } = JSON.parse(
      await readFile(join(ARTIFACT_ROOT, 'provenance.json'), 'utf8'),
    );
    // One Playwright revision is a different Chromium patch per platform.
    const build = (name: string) => name.slice(0, name.lastIndexOf('.'));

    expect(provenance).toEqual({
      generatedBy: 'examples/visual-review-case/scripts/generate.mjs',
      causes: result!.observation.causes,
    });
    expect(build(engine)).toBe(build(result!.engine));
    expect(['darwin', 'linux', 'win32']).toContain(raster);
    expect(changedPixels).toBeGreaterThan(0);
  });
});

// Reads committed files only, so it runs with or without a browser.
describe("the visual-review example's committed artifacts", () => {
  it('holds the actual derived diff of the committed PNGs', async () => {
    const [before, after, diff] = await Promise.all([
      readFile(join(ARTIFACT_ROOT, 'before.png')),
      readFile(join(ARTIFACT_ROOT, 'after.png')),
      readFile(join(ARTIFACT_ROOT, 'diff.png')),
    ]);
    expect(diff).toEqual(await diffImage(before, after));
  });

  it('counts the pixels the comparison counts between the committed PNGs', async () => {
    const [before, after, provenance, report] = await Promise.all([
      readFile(join(ARTIFACT_ROOT, 'before.png')),
      readFile(join(ARTIFACT_ROOT, 'after.png')),
      readFile(join(ARTIFACT_ROOT, 'provenance.json'), 'utf8'),
      readFile(join(ARTIFACT_ROOT, 'report.txt'), 'utf8'),
    ]);
    const changed = comparePngs(before, after).changed.default;
    expect(JSON.parse(provenance).changedPixels).toBe(changed);
    expect(report).toContain(`${changed.toLocaleString('en-US')} pixels differ`);
  });

  it('is quoted on the visual-review pages line for line', async () => {
    const report = await readFile(join(ARTIFACT_ROOT, 'report.txt'), 'utf8');
    const lines = new Set(report.split('\n'));
    for (const page of ['path-visual-review.md', 'explain-variance.md']) {
      const text = await readFile(join(REPOSITORY_ROOT, 'docs', page), 'utf8');
      const quoted = [...text.matchAll(/```text\n([\s\S]*?)```/g)]
        .flatMap((block) => block[1]!.split('\n'))
        .filter((line) => / · (cause|displaced) · /.test(line) || line.startsWith('pricing/plans:'));
      expect(quoted.length, page).toBeGreaterThan(0);
      for (const line of quoted) expect(lines, `${page}: ${line}`).toContain(line);
    }
  });
});
