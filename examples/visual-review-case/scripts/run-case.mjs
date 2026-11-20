import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(HERE, '..');
export const REPOSITORY_ROOT = join(PACKAGE_ROOT, '..', '..');
export const ARTIFACT_ROOT = join(PACKAGE_ROOT, 'artifacts');
/** Where `variance.config.json` has the run write: ignored, and cleared before each run. */
export const RUN_ROOT = join(PACKAGE_ROOT, '.variance');

const CLI = join(REPOSITORY_ROOT, 'packages', 'cli', 'dist', 'bin.js');
const SUBJECT = 'pricing-plans';
/** Where the comment's pictures resolve: this example's artifacts on `main`. */
export const IMAGE_ROOT =
  'https://raw.githubusercontent.com/Variance-Authority/variance-authority/main/examples/visual-review-case/artifacts';

/** One `variance` command, run in this directory as a project runs it. */
function variance(argv, variant, codes = [0]) {
  const run = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    env: { ...process.env, VISUAL_REVIEW_VARIANT: variant ?? '' },
  });
  if (!codes.includes(run.status ?? -1)) {
    throw new Error(`variance ${argv.join(' ')} exited ${run.status}\n${run.stdout}${run.stderr}`);
  }
  return run.stdout;
}

/**
 * Run the case through the CLI: `variance run` on the `before` revision,
 * `variance accept` to keep it as the baseline, `variance run` on `after`,
 * then `variance ask describe` and `variance comment` over that run.
 *
 * The collector reads the page agent from `dist/`, so the bundle is built first.
 */
export async function runVisualReviewCase() {
  const bundle = await build({
    entryPoints: [join(PACKAGE_ROOT, 'src', 'page-agent.js')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
  });
  await mkdir(join(PACKAGE_ROOT, 'dist'), { recursive: true });
  await writeFile(join(PACKAGE_ROOT, 'dist', 'page-agent.bundle.js'), bundle.outputFiles[0].text);
  await rm(RUN_ROOT, { recursive: true, force: true });

  variance(['run'], 'before', [0, 1]);
  variance(['accept', SUBJECT]);
  // 1: the run found a change that needs review, which is the case.
  variance(['run'], 'after', [1]);
  const report = variance(['ask', 'describe', '--subject', SUBJECT]);
  const comment = variance(['comment', '--image-root', IMAGE_ROOT, join(RUN_ROOT, 'run.json')]);
  const runReport = JSON.parse(await readFile(join(RUN_ROOT, 'run.json'), 'utf8'));
  return { runReport, record: runReport.observations[0], report, comment };
}
