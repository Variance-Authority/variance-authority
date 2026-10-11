/**
 * Whether the tests that hand files to ripgrep can run on this machine.
 *
 * `docs_grep` shells out to `rg`, and a machine without it cannot run the
 * tests that ask it to. On a developer's machine that is theirs to install, so
 * those tests skip. On CI it is a missing step: a skip there leaves the check
 * green and reports the code as run by no case, so a CI run without `rg`
 * fails instead, naming the action that installs it.
 */

// compass: variance-authority.report.agent-surface

import { spawnSync } from 'node:child_process';

/** True when `rg` starts; false on a developer's machine without it; throws on CI without it. */
export function ripgrepOnPath(env: NodeJS.ProcessEnv = process.env): boolean {
  if (spawnSync('rg', ['--version'], { env }).error === undefined) return true;
  if (!env.CI || env.CI === 'false') return false;
  throw new Error(
    '`rg` is not on PATH, and CI runs the tests that need it rather than skip them: add `./.github/actions/ripgrep` to this job.',
  );
}

/** Whether this machine runs the ripgrep tests, decided once per test file. */
export const RIPGREP_ON_PATH = ripgrepOnPath();
