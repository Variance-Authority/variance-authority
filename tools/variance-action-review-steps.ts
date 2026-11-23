import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { ROOT } from './variance-action-steps.js';

/**
 * The review action's steps, and one step's script run as the action runs it,
 * under a fake CLI. Shared by the checks of `Variance-Authority/action/review`.
 */

export { ROOT };
export const FOLDER = '.github/actions/variance';
export const ACTION = `${FOLDER}/review/action.yml`;

export const MARKER = '<!-- variance-authority: review -->';
export const BADGE = '{"schemaVersion":1,"label":"regions run","message":"75.0%","color":"blue"}';
/** Two levels under the checkout, as a runner's workspace sits two levels under the folder that holds the actions. */
const WORKSPACE = join(ROOT, 'work', 'repository');

export interface Step {
  readonly name: string;
  readonly id?: string;
  readonly if?: string;
  readonly run: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, string>>;
  readonly env?: Readonly<Record<string, string>>;
  readonly 'continue-on-error'?: boolean;
}

export const action = (): { inputs: Record<string, unknown>; outputs?: unknown; runs: { steps: readonly Step[] } } =>
  parse(readFileSync(join(ROOT, ACTION), 'utf8'));

export function stepNamed(name: string): Step {
  const step = action().runs.steps.find((one) => one.name === name);
  if (step === undefined) throw new Error(`the review action has no step ${name}`);
  return step;
}

/**
 * What the step named `step` asked the CLI, wrote and exited with, under a CLI that exits `exit` on `review`
 * and `coverage`. With `reviewed`, the review step has already written its file, as it has for every step after it.
 */
export async function ran(step: string, env: Readonly<Record<string, string>> = {}, exit = 0, reviewed = false) {
  const at = await mkdtemp(join(tmpdir(), 'variance-action-review-'));
  try {
    if (reviewed) {
      await mkdir(join(at, 'review'));
      await writeFile(join(at, 'review', 'review.md'), `${MARKER}\nthe review\n`);
    }
    const fake = join(at, 'variance');
    await writeFile(
      fake,
      `#!/bin/bash\necho "$*" >> "${at}/said"\nif [ "$1" = review ]; then\n  [ ${exit} = 0 ] || exit ${exit}\n  mkdir -p "$REVIEW"\n  printf '${MARKER}\\nthe review\\n' > "$REVIEW/review.md"\n  echo the summary\nfi\nif [ "$1" = coverage ]; then\n  [ ${exit} = 0 ] || exit ${exit}\n  echo '${BADGE}'\nfi\n`,
      { mode: 0o755 },
    );
    await writeFile(join(at, 'output'), '');
    await writeFile(join(at, 'summary'), '');
    // The expressions GitHub fills in, filled the way a job on the host has them.
    const run = stepNamed(step).run
      .replaceAll('${{ github.action_path }}', join(ROOT, dirname(ACTION)))
      .replaceAll('${{ github.workspace }}', WORKSPACE);
    let status = 0;
    let printed = '';
    try {
      // The shell GitHub runs a `shell: bash` step under, errexit and all.
      printed = execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', run], {
        env: {
          ...process.env,
          VARIANCE_COMMAND: fake,
          REVIEW: join(at, 'review'),
          GITHUB_OUTPUT: join(at, 'output'),
          GITHUB_STEP_SUMMARY: join(at, 'summary'),
          GITHUB_WORKSPACE: WORKSPACE,
          RUNNER_TEMP: at,
          ...env,
        },
        stdio: 'pipe',
        encoding: 'utf8',
      });
    } catch (error) {
      ({ status, stdout: printed } = error as { status: number; stdout: string });
    }
    const read = (name: string): Promise<string> => readFile(join(at, name), 'utf8').catch(() => '');
    return {
      status,
      printed,
      said: (await read('said')).trim().split('\n').map((line) => line.replaceAll(at, '<at>')),
      output: (await read('output')).replaceAll(at, '<at>'),
      summary: await read('summary'),
      review: await read('review/review.md'),
    };
  } finally {
    await rm(at, { recursive: true, force: true });
  }
}

export const git = (dir: string, ...args: string[]) => execFileSync('git', ['--git-dir', dir, ...args], { encoding: 'utf8' }).trim();

/** Moves `main` of the bare repository to a new commit, as a push to it does, and answers the commit. */
export const pushed = (dir: string, message: string) => {
  const tree = execFileSync('git', ['--git-dir', dir, 'mktree'], { input: '', encoding: 'utf8' }).trim();
  const commit = execFileSync('git', ['--git-dir', dir, '-c', 'user.name=a', '-c', 'user.email=a@a', 'commit-tree', tree, '-m', message], { encoding: 'utf8' }).trim();
  git(dir, 'update-ref', 'refs/heads/main', commit);
  return commit;
};

/** A bare repository a step pushes to, as it would push to this run's repository, its `main` at the run's commit. */
export async function origin(): Promise<{ readonly env: Record<string, string>; readonly dir: string; readonly done: () => Promise<void> }> {
  const at = await mkdtemp(join(tmpdir(), 'variance-action-origin-'));
  const dir = join(at, 'origin.git');
  execFileSync('git', ['init', '--quiet', '--bare', dir]);
  return {
    dir,
    env: { GITHUB_SERVER_URL: `file://${at}`, GITHUB_REPOSITORY: 'origin', GITHUB_TOKEN: 'token', GITHUB_SHA: pushed(dir, 'ran'), BRANCH: 'main' },
    done: () => rm(at, { recursive: true, force: true }),
  };
}
