import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ARTIFACT_ROOT, RUN_ROOT, runVisualReviewCase } from './run-case.mjs';

const result = await runVisualReviewCase();

// The run's own files, in the layout `variance run` wrote them, so the paths
// in `run.json` and the comment's picture URLs resolve inside `artifacts/`.
await rm(ARTIFACT_ROOT, { recursive: true, force: true });
await mkdir(ARTIFACT_ROOT, { recursive: true });
await cp(join(RUN_ROOT, 'run.json'), join(ARTIFACT_ROOT, 'run.json'));
await cp(join(RUN_ROOT, 'images'), join(ARTIFACT_ROOT, 'images'), { recursive: true });
await writeFile(join(ARTIFACT_ROOT, 'report.txt'), result.report, 'utf8');
await writeFile(join(ARTIFACT_ROOT, 'comment.md'), result.comment, 'utf8');

process.stdout.write(result.report);
