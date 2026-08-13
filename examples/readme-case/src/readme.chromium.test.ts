import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffImage } from '@variance-authority/png';
import { ARTIFACT_ROOT, REPOSITORY_ROOT, runReadmeCase } from '../scripts/run-case.mjs';

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\nexamples/readme-case: skipped.\n  no browser — npx playwright install chromium\n',
  );
}

let result: Awaited<ReturnType<typeof runReadmeCase>> | undefined;

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  result = await runReadmeCase();
}, 120_000);

afterAll(() => {
  result = undefined;
});

describe.skipIf(!BROWSER_AVAILABLE)('the root README example', () => {
  it('changes paint, and nothing else in the document', () => {
    expect(result!.before.structureHash).toBe(result!.after.structureHash);
    expect(result!.semantic.deltas).toHaveLength(1);
    expect(result!.semantic.deltas[0]).toMatchObject({
      kind: 'style-changed',
      property: 'background-color',
      impact: 'paint',
    });
  });

  it('produces a real pixel difference without changing dimensions', () => {
    expect(result!.comparison.dimensionsChanged).toBe(false);
    expect(result!.comparison.changed.default).toBeGreaterThan(0);
  });

  it('shares the generated report without rewriting it', async () => {
    const committed = await readFile(join(ARTIFACT_ROOT, 'report.txt'), 'utf8');
    expect(committed).toBe(`${result!.report}\n`);

    const readme = await readFile(join(REPOSITORY_ROOT, 'README.md'), 'utf8');
    expect(readme).toContain(`\`\`\`text\n${result!.report}\n\`\`\``);
  });

  it('displays the generated PNGs and their actual derived diff', async () => {
    const [before, after, diff, readme] = await Promise.all([
      readFile(join(ARTIFACT_ROOT, 'before.png')),
      readFile(join(ARTIFACT_ROOT, 'after.png')),
      readFile(join(ARTIFACT_ROOT, 'diff.png')),
      readFile(join(REPOSITORY_ROOT, 'README.md'), 'utf8'),
    ]);

    expect(diff).toEqual(diffImage(before, after));
    for (const name of ['before.png', 'after.png', 'diff.png']) {
      expect(readme).toContain(`examples/readme-case/artifacts/${name}`);
    }
  });

  it('records which browser and semantic delta produced the artifacts', async () => {
    const provenance = JSON.parse(
      await readFile(join(ARTIFACT_ROOT, 'provenance.json'), 'utf8'),
    );
    const delta = result!.semantic.deltas[0]!;

    expect(provenance).toEqual({
      generatedBy: 'examples/readme-case/scripts/generate.mjs',
      engine: result!.engine,
      change: {
        kind: delta.kind,
        property: delta.property,
        from: delta.from,
        to: delta.to,
        impact: delta.impact,
      },
      changedPixels: result!.comparison.changed.default,
    });
  });
});
