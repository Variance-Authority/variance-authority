import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ARTIFACT_ROOT, runVisualReviewCase } from './run-case.mjs';

const result = await runVisualReviewCase();

await mkdir(ARTIFACT_ROOT, { recursive: true });
await Promise.all([
  writeFile(join(ARTIFACT_ROOT, 'before.png'), result.beforePng),
  writeFile(join(ARTIFACT_ROOT, 'after.png'), result.afterPng),
  writeFile(join(ARTIFACT_ROOT, 'diff.png'), result.diffPng),
  writeFile(join(ARTIFACT_ROOT, 'report.txt'), `${result.report}\n`, 'utf8'),
  writeFile(
    join(ARTIFACT_ROOT, 'provenance.json'),
    `${JSON.stringify(
      {
        generatedBy: 'examples/visual-review-case/scripts/generate.mjs',
        engine: result.engine,
        raster: process.platform,
        causes: result.observation.causes,
        changedPixels: result.observation.comparison?.changed.default,
      },
      null,
      2,
    )}\n`,
    'utf8',
  ),
]);

process.stdout.write(`${result.report}\n`);
