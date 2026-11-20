import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toolByName } from '@variance-authority/mcp/tools';
import { comparePixels, decodePortable } from '@variance-authority/png';
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

/**
 * A fenced `text` block quotes the report when it opens the way one of the
 * report's own lines does: its headline, its `components:` block, or a row
 * naming a cause or a collateral component.
 */
const quotedBlocks = (page: string) =>
  [...page.matchAll(/```text\n([\s\S]*?)```/g)]
    .map((block) => block[1]!)
    .filter((block) => /^(\[changed\] pricing-plans|[\d,]+ pixels differ|components:|\s*(cause|collateral) +)/.test(block));

/** Whether every line of `excerpt` is a line of `text`, in the same order. */
const inOrder = (text: string, excerpt: string) => {
  const lines = text.split('\n');
  let at = 0;
  for (const line of excerpt.trimEnd().split('\n')) {
    at = lines.indexOf(line, at) + 1;
    if (at === 0) return false;
  }
  return true;
};

const artifact = (name: string) => readFile(join(ARTIFACT_ROOT, name), 'utf8');
/** A picture `run.json` names, read where its path points: beside that report. */
const picture = async (side: 'before' | 'after') => {
  const { observations } = JSON.parse(await artifact('run.json'));
  return decodePortable(await readFile(join(ARTIFACT_ROOT, observations[0].images[side])));
};
const causes = (record: { moved?: { component: string; cause: boolean }[] }) =>
  (record.moved ?? []).filter((entry) => entry.cause).map((entry) => entry.component);
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
  const moved = (component: string) => result!.record.moved?.find((entry) => entry.component === component);

  it('inserts the notice rows and compares the cards under them with the rows they were', () => {
    expect(result!.record.because).toContain('44 pixel rows inserted in 1 place');
    expect(moved('Notice')?.presence).toBe('added');
    expect(moved('Plans')?.grew).toEqual({ width: 0, height: 44 });
    // The names and prices only moved: the alignment pairs their rows, so no region is theirs.
    expect(result!.record.regions.map((region) => region.component)).toEqual([
      'Notice',
      'ChooseButton',
      'PlanCard',
      'PlanCard',
      'PlanCard',
    ]);
  });

  it('reports the names and prices the notice pushed down as collateral, not as causes', () => {
    expect(causes(result!.record)).toEqual(['ChooseButton', 'Notice', 'PlanCard', 'Plans']);
    expect(Object.fromEntries((result!.record.moved ?? []).map((entry) => [entry.component, entry.cause]))).toEqual({
      ChooseButton: true,
      Notice: true,
      PlanCard: true,
      PlanName: false,
      Plans: true,
      Price: false,
    });
  });

  it('names the bands each component changed in, and the values the button and the rules changed', () => {
    expect(Object.fromEntries((result!.record.moved ?? []).map((entry) => [entry.component, entry.bands]))).toEqual({
      ChooseButton: ['geometry', 'token'],
      Notice: ['geometry'],
      PlanCard: ['geometry', 'token'],
      PlanName: ['geometry'],
      Plans: ['geometry'],
      Price: ['geometry'],
    });
    expect(moved('ChooseButton')?.changed).toEqual([
      { property: 'background-color', from: [], to: ['rgb(255 74 25 / 1)'] },
    ]);
    expect(moved('PlanCard')?.changed).toEqual([
      { property: 'border-bottom-color', from: ['rgb(226 226 226 / 1)'], to: ['rgb(216 216 216 / 1)'] },
    ]);
  });

  it('grades the notice and the button strong, and the darker rules faint', () => {
    const strong = result!.record.regions.filter((region) => region.grade >= 3).map((region) => region.component);
    const faint = result!.record.regions.filter((region) => region.grade < 3).map((region) => region.component);
    expect(strong).toEqual(['Notice', 'ChooseButton']);
    expect(faint).toEqual(['PlanCard', 'PlanCard', 'PlanCard']);
  });

  it('places every region on a landmark path and the line its component is declared at', () => {
    const at = result!.record.regions.slice(0, 2).map((region) => [region.component, region.where, region.file]);
    expect(at).toEqual([
      ['Notice', 'main → region "Plans"', 'examples/visual-review-case/src/plans.js:78'],
      [
        'ChooseButton',
        'main → region "Plans" → list item 2 of 3 → button "Choose"',
        'examples/visual-review-case/src/plans.js:64',
      ],
    ]);
    for (const rule of result!.record.regions.slice(2)) {
      expect(rule.file).toBe('examples/visual-review-case/src/plans.js:91');
      expect(rule.where).toMatch(/^main → region "Plans" → list item \d of 3$/);
    }
  });

  it('commits the answer `variance ask describe` gives for this run', async () => {
    expect(shape(await artifact('report.txt'))).toBe(shape(result!.report));
  });

  it('commits the pull-request comment `variance comment` writes for this run', async () => {
    // The footer names the machine and the moment that painted the images.
    const counts = (comment: string) =>
      shape(comment)
        .replace(/\d+px/g, 'Npx')
        .replace(/^.* · durable retention · .*$/m, 'FOOTER');
    expect(counts(await artifact('comment.md'))).toBe(counts(result!.comment));
  });

  it('commits a run of the same engine that names the same causes', async () => {
    const { identity, observations } = JSON.parse(await artifact('run.json'));
    // One Playwright revision is a different Chromium patch per platform.
    const build = (name: string) => name.slice(0, name.lastIndexOf('.'));

    expect(build(identity.engine)).toBe(build(result!.runReport.identity.engine));
    expect(causes(observations[0])).toEqual(causes(result!.record));
  });
});

// Reads committed files only, so it runs with or without a browser.
describe("the visual-review example's committed artifacts", () => {
  it('holds what `variance ask describe` answers over the committed run report', async () => {
    const [report, text] = await Promise.all([artifact('run.json'), artifact('report.txt')]);
    expect(toolByName('variance_describe').run(JSON.parse(report), { subject: 'pricing-plans' })).toBe(text.trimEnd());
  });

  it('counts the pixels the comparison counts between the committed pictures', async () => {
    const [before, after, report, text] = await Promise.all([
      picture('before'),
      picture('after'),
      artifact('run.json'),
      artifact('report.txt'),
    ]);
    const changed = comparePixels(before, after).changed.default;
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

  it('is quoted on those pages in its own lines, in order', async () => {
    const report = await artifact('report.txt');
    let quoted = 0;
    for (const name of QUOTING_PAGES) {
      for (const block of quotedBlocks(await page(name))) {
        quoted += 1;
        expect(inOrder(report, block), `${name}:\n${block}`).toBe(true);
      }
    }
    expect(quoted).toBeGreaterThan(3);
  });

  it("states the button's region, its line and the comment's cause as the artifacts have them", async () => {
    const [{ observations }, comment, path] = await Promise.all([
      artifact('run.json').then(JSON.parse),
      artifact('comment.md'),
      page('path-visual-review.md'),
    ]);
    const button = observations[0].regions.find((entry: { component: string }) => entry.component === 'ChooseButton');
    const cause = comment.split('\n').find((line) => line.startsWith('Cause: '))!;

    expect(path).toContain(`${button.pixels}px at ${button.x},${button.y} ${button.width}×${button.height}`);
    expect(path).toContain(`You open \`plans.js\` at line ${button.file.split(':')[1]}`);
    expect(path).toContain(`\`\`\`text\n${cause}\n\`\`\``);
  });
});
