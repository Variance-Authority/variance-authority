/**
 * Runs the incumbent arm, in the two phases a team runs it in.
 *
 *   1. record  — `CASE_VARIANT=before playwright test --update-snapshots`
 *   2. compare — `CASE_VARIANT=after  playwright test`
 *
 * Which is the trunk-then-branch workflow, not a simulation of it: the baselines
 * written in phase 1 are the ones phase 2 is judged against, by their runner,
 * with their comparator and their thresholds.
 *
 * Everything under `incumbent/` is removed first. A run that inherited the last
 * run's baselines would quietly answer a different question — and the
 * new-subject scenario would answer the *wrong* one, because Playwright writes a
 * missing snapshot on the failing run, so a second compare would find the
 * baseline the first one recorded and pass.
 *
 * Phase 2 exits non-zero. That is the expected outcome and not an error: five of
 * the eight scenarios are meant to fail, and a phase that exited clean would mean
 * the corpus stopped changing anything.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from './bundle.mjs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const ARTIFACTS = resolve(ROOT, 'incumbent');
export const RESULTS = resolve(ARTIFACTS, 'results.json');
export const BASELINES = resolve(ARTIFACTS, 'baselines');

/**
 * Their CLI, resolved rather than assumed to be on the path.
 *
 * `npx playwright` would happily download a *different* version into a cache if
 * the workspace's copy went missing, and a case that silently ran a version
 * nobody installed would be measuring a tool this repository does not depend on.
 */
function cli() {
  return require.resolve('@playwright/test/cli');
}

function phase(name, variant, extra) {
  const result = spawnSync(process.execPath, [cli(), 'test', ...extra], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, CASE_VARIANT: variant },
  });

  if (result.error) throw result.error;
  console.log(`\n[${name}] exit ${result.status}`);
  return result.status ?? 1;
}

export function runIncumbent() {
  rmSync(ARTIFACTS, { recursive: true, force: true });

  const record = phase('record', 'before', ['--update-snapshots']);
  if (record !== 0) {
    throw new Error(
      `the record phase must pass — with --update-snapshots every screenshot is written, ` +
        `so a non-zero exit means the page itself is broken (exit ${record})`,
    );
  }

  // Non-zero is expected here, and is not checked: what the compare phase found
  // is read from `results.json` per scenario, and an exit code cannot say which
  // of eight scenarios it came from.
  phase('compare', 'after', []);

  if (!existsSync(RESULTS)) {
    throw new Error(`the compare phase wrote no report at ${RESULTS}`);
  }
  return RESULTS;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await bundle();
  console.log(runIncumbent());
}
