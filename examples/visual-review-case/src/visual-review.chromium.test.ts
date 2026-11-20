import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toolByName } from '@variance-authority/mcp/tools';
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
 * The report with its raster measurements blanked. One Chromium build
 * rasterizes text differently on macOS and Linux by a glyph edge, so the pixel
 * counts, the region boxes and the shape fingerprints are claims about the
 * committed PNGs, checked below; every other word is this run's.
 */
const shape = (report: string) =>
  report
    .replace(/[\d,]+ pixels/g, 'N pixels')
    .replace(/\d+px at \d+,\d+ \d+×\d+/g, 'Npx at X,Y W×H')
    .replace(/shape v1:[0-9a-f]+/g, 'shape v1:F');

/** The documentation pages that name the example, each pinned below. */
const QUOTING_PAGES = ['attribution.md', 'compare-visual-review.md', 'explain-variance.md', 'path-visual-review.md'];

/** A fenced `text` block quotes the report when it names one of its components. */
const quotedBlocks = (page: string) =>
  [...page.matchAll(/```text\n([\s\S]*?)```/g)]
    .map((block) => block[1]!)
    .filter((block) => /ChooseButton|PlanName|Price/.test(block));

const artifact = (name: string) => readFile(join(ARTIFACT_ROOT, name), 'utf8');
const page = (name: string) => readFile(join(REPOSITORY_ROOT, 'docs', name), 'utf8');

let result: Awaited<ReturnType<typeof runVisualReviewCase>> | undefined;

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  result = await runVisualReviewCase();
}, 120_000);

afterAll(() => {
  result = undefined;
});

describe.skipIf(!BROWSER_AVAILABLE)('the visual-review example', () => {
  it('reports the price the longer name pushed down as collateral, not as a cause', () => {
    expect(result!.observation.causes).toEqual(['ChooseButton', 'PlanName']);
    expect(Object.fromEntries((result!.record.moved ?? []).map((entry) => [entry.component, entry.cause]))).toEqual({
      ChooseButton: true,
      PlanName: true,
      Price: false,
    });
    expect(result!.record.regions.find((region) => region.component === 'Price')?.cause).toBe(false);
  });

  it('names the bands each moved component changed in, and the value the button changed', () => {
    const moved = result!.record.moved ?? [];
    expect(Object.fromEntries(moved.map((entry) => [entry.component, entry.bands]))).toEqual({
      ChooseButton: ['token'],
      PlanName: ['a11y', 'geometry', 'content'],
      Price: ['geometry'],
    });
    expect(moved.find((entry) => entry.component === 'ChooseButton')?.changed).toEqual([
      { property: 'background-color', from: [], to: ['rgb(255 74 25 / 1)'] },
    ]);
  });

  it('places every region on a landmark path and the line its component is declared at', () => {
    const at = Object.fromEntries(result!.record.regions.map((region) => [region.component, [region.where, region.file]]));
    expect(at).toEqual({
      ChooseButton: [
        'main → region "Plans" → list item 2 of 3 → button "Choose"',
        'examples/visual-review-case/src/plans.js:53',
      ],
      PlanName: [
        'main → region "Plans" → list item 2 of 3 → heading "Team, billed yearly for every seat"',
        'examples/visual-review-case/src/plans.js:30',
      ],
      Price: ['main → region "Plans" → list item 2 of 3', 'examples/visual-review-case/src/plans.js:42'],
    });
  });

  it('commits the answer `variance ask describe` gives for this run', async () => {
    expect(shape(await artifact('report.txt'))).toBe(shape(`${result!.report}\n`));
  });

  it('records which browser produced the artifacts and which components caused the change', async () => {
    const { changedPixels, raster, engine, ...provenance } = JSON.parse(await artifact('provenance.json'));
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

  it('holds what `variance ask describe` answers over the committed run report', async () => {
    const [report, text] = await Promise.all([artifact('report.json'), artifact('report.txt')]);
    expect(`${toolByName('variance_describe').run(JSON.parse(report), { subject: 'pricing/plans' })}\n`).toBe(text);
  });

  it('counts the pixels the comparison counts between the committed PNGs', async () => {
    const [before, after, provenance, report, text] = await Promise.all([
      readFile(join(ARTIFACT_ROOT, 'before.png')),
      readFile(join(ARTIFACT_ROOT, 'after.png')),
      artifact('provenance.json'),
      artifact('report.json'),
      artifact('report.txt'),
    ]);
    const changed = comparePngs(before, after).changed.default;
    expect(JSON.parse(provenance).changedPixels).toBe(changed);
    expect(JSON.parse(report).observations[0].changedPixels).toBe(changed);
    expect(text).toContain(`${changed.toLocaleString('en-US')} pixels differ`);
  });

  it('is pinned on every documentation page that names the example', async () => {
    const docs = join(REPOSITORY_ROOT, 'docs');
    const naming: string[] = [];
    for (const name of await readdir(docs)) {
      if (name.endsWith('.md') && (await page(name)).includes('visual-review-case')) naming.push(name);
    }
    expect(naming.sort()).toEqual(QUOTING_PAGES);
  });

  it('is quoted on those pages as a run of its own lines', async () => {
    const report = await artifact('report.txt');
    let quoted = 0;
    for (const name of QUOTING_PAGES) {
      const text = await page(name);
      for (const block of quotedBlocks(text)) {
        quoted += 1;
        expect(report, `${name}:\n${block}`).toContain(block);
      }
      if (/\d[\d,]* pixels differ/.test(text)) {
        for (const [line] of text.matchAll(/^.*\d[\d,]* pixels differ.*$/gm)) {
          if (line.includes('regions in ChooseButton')) expect(report.split('\n'), name).toContain(line);
        }
      }
    }
    expect(quoted).toBeGreaterThan(0);
  });

  it("states the regions' pixel counts and lines as the report has them", async () => {
    const { observations } = JSON.parse(await artifact('report.json'));
    const region = Object.fromEntries(
      observations[0].regions.map((entry: { component: string; pixels: number; file: string }) => [
        entry.component,
        entry,
      ]),
    );
    const [path, attribution] = await Promise.all([page('path-visual-review.md'), page('attribution.md')]);

    expect(path).toContain(`The price is ${region.Price.pixels} pixels of red`);
    expect(path).toContain(`You open \`plans.js\` at line ${region.ChooseButton.file.split(':')[1]}`);
    expect(attribution).toContain(
      `Its ${region.Price.pixels} differing pixels are fewer than the name's ${region.PlanName.pixels} ` +
        `and the button's ${region.ChooseButton.pixels}`,
    );
  });
});
