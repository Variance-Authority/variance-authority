import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ARTIFACT_ROOT, runReadmeCase } from './run-case.mjs';

const result = await runReadmeCase();

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
        generatedBy: 'examples/readme-case/scripts/generate.mjs',
        engine: result.engine,
        change: {
          kind: result.semantic.deltas[0]?.kind,
          property: result.semantic.deltas[0]?.property,
          from: result.semantic.deltas[0]?.from,
          to: result.semantic.deltas[0]?.to,
          impact: result.semantic.deltas[0]?.impact,
        },
        changedPixels: result.comparison.changed.default,
      },
      null,
      2,
    )}\n`,
    'utf8',
  ),
]);

process.stdout.write(`${result.report}\n`);
